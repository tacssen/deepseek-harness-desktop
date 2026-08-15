const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { redact } = require('./logger.cjs');

const execFileAsync = promisify(execFile);
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 200 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_FILES = 4000;
const MAX_DEPTH = 5;
const DEFAULT_PROFILE_RELATIVE = path.join('profile', 'plugins');
const MANIFEST_NAMES = ['dsh-plugin.json', '.dsh-plugin.json', 'manifest.json', 'package.json'];
const PERMISSIVE_LICENSES = new Set([
  '0BSD', 'APACHE-2.0', 'BSD-2-CLAUSE', 'BSD-3-CLAUSE', 'CC0-1.0', 'ISC', 'MIT', 'UNLICENSE', 'ZLIB',
]);
const MANIFEST_KINDS = new Set(['dsh-plugin', 'dsh-bundle', 'deepseek-harness-plugin']);

class MarketplaceError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'MarketplaceError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function failure(code, message, details) { return new MarketplaceError(code, message, details); }

function normalizeLicense(value) {
  if (value && typeof value === 'object') value = value.spdx_id || value.spdx || value.key || value.name;
  const raw = String(value || '').trim();
  const key = raw.toUpperCase().replace(/[\s_]+/g, '-');
  const aliases = { 'APACHE2': 'APACHE-2.0', 'APACHE-2': 'APACHE-2.0', 'BSD2': 'BSD-2-CLAUSE', 'BSD3': 'BSD-3-CLAUSE', 'CC0': 'CC0-1.0', 'UNLICENSED': 'UNLICENSE' };
  return aliases[key] || key;
}

function isPermissiveLicense(value) { return PERMISSIVE_LICENSES.has(normalizeLicense(value)); }

function normalizeRepo(value) {
  if (value && typeof value === 'object') value = value.full_name || value.fullName || value.name || value.url || value.html_url;
  let raw = String(value || '').trim();
  if (!raw) return null;
  raw = raw.replace(/^git\+/, '').replace(/^git@github\.com:/i, 'https://github.com/').replace(/^https?:\/\/(?:www\.)?github\.com\//i, '').replace(/^github\.com\//i, '').replace(/\.git(?:\/)?$/i, '').replace(/\/$/, '');
  const parts = raw.split('/');
  if (parts.length !== 2 || !/^[A-Za-z0-9_.-]{1,100}$/.test(parts[0]) || !/^[A-Za-z0-9_.-]{1,100}$/.test(parts[1])) return null;
  return `${parts[0].toLowerCase()}/${parts[1].toLowerCase()}`;
}

function within(root, candidate) {
  const base = path.resolve(root);
  const resolved = path.resolve(base, candidate);
  const relative = path.relative(base, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw failure('PATH_OUTSIDE_PROFILE', '路径必须位于插件 Profile 内');
  return { absolute: resolved, relative: relative || '.' };
}

function safeSegment(value, fallback = 'plugin') {
  const valueText = String(value || fallback).normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 90);
  return valueText || fallback;
}

function safeSemver(value) { return /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(String(value || '').trim()); }

function safeRelativeEntry(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) return null;
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return null;
  const parts = normalized.split('/');
  if (parts.some((part) => part === '..' || part === '')) return null;
  return parts.join(path.sep);
}

function manifestPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.dsh && typeof value.dsh === 'object') return value.dsh;
  if (value.deepseekHarness && typeof value.deepseekHarness === 'object') return value.deepseekHarness;
  return value;
}

function validateManifest(value, { bundleRoot, expectedRepo, expectedLicense } = {}) {
  const manifest = manifestPayload(value);
  if (!manifest) throw failure('INVALID_MANIFEST', '插件缺少合法 dsh bundle manifest');
  const kind = String(manifest.kind || manifest.type || '').trim().toLowerCase();
  if (!MANIFEST_KINDS.has(kind) && manifest.api !== 'dsh') throw failure('INVALID_MANIFEST', '插件 manifest 类型不是 dsh-plugin');
  const name = String(manifest.name || '').trim();
  const version = String(manifest.version || '').trim();
  if (!name || !/^[A-Za-z0-9@._/-]{1,160}$/.test(name)) throw failure('INVALID_MANIFEST', '插件 manifest 名称无效');
  if (!safeSemver(version)) throw failure('INVALID_MANIFEST', '插件 manifest 版本无效');
  const entry = safeRelativeEntry(manifest.entry || manifest.main || manifest.entrypoint);
  if (!entry) throw failure('INVALID_MANIFEST', '插件 manifest entry 必须是 Profile 内的相对路径');
  const license = normalizeLicense(manifest.license || manifest.spdx || manifest.licenseId);
  if (!isPermissiveLicense(license)) throw failure('LICENSE_NOT_ALLOWED', '插件必须使用允许的宽松许可证');
  if (expectedLicense && normalizeLicense(expectedLicense) !== license) throw failure('LICENSE_MISMATCH', '插件许可证与 verified allowlist 不一致');
  let entryAbsolute;
  if (bundleRoot) {
    entryAbsolute = within(bundleRoot, entry).absolute;
    if (!/\.(?:cjs|mjs|js|json|ya?ml)$/i.test(entryAbsolute)) throw failure('INVALID_MANIFEST', '插件 entry 必须是受支持的 dsh bundle 文件');
  }
  const repo = normalizeRepo(manifest.repo || manifest.repository || manifest.source);
  if (expectedRepo && repo && repo !== expectedRepo) throw failure('MANIFEST_REPO_MISMATCH', '插件 manifest 来源与 verified allowlist 不一致');
  if (manifest.permissions !== undefined && (!Array.isArray(manifest.permissions) || manifest.permissions.some((item) => typeof item !== 'string' || item.length > 120))) throw failure('INVALID_MANIFEST', '插件权限声明无效');
  return { kind: kind || 'dsh-plugin', name, version, entry, license, repo: repo || expectedRepo || null, permissions: Array.isArray(manifest.permissions) ? manifest.permissions.slice(0, 80) : [] };
}

function normalizeAllowlist(input) {
  const entries = new Map();
  const source = Array.isArray(input) ? Object.fromEntries(input.map((entry) => [entry?.repo || entry?.repository, entry])) : input || {};
  for (const [key, raw] of Object.entries(source)) {
    const entry = typeof raw === 'string' ? { ref: raw } : { ...raw };
    const repo = normalizeRepo(entry.repo || entry.repository || key);
    if (!repo || entry.verified !== true || !entry.ref) continue;
    const license = normalizeLicense(entry.license || entry.spdx);
    if (license && !isPermissiveLicense(license)) continue;
    entries.set(repo, { ...entry, repo, ref: String(entry.ref), license: license || undefined, verified: true });
  }
  return entries;
}

function normalizePlugin(value = {}) {
  const plugin = value && typeof value === 'object' ? value : { repo: value };
  const repository = plugin.repository && typeof plugin.repository === 'object' ? plugin.repository : {};
  const repo = normalizeRepo(plugin.repo || plugin.repositoryUrl || repository.full_name || repository.fullName || repository.url || plugin.html_url || plugin.url || plugin.id);
  const license = normalizeLicense(plugin.license?.spdx_id || plugin.license?.name || plugin.license);
  return {
    ...plugin,
    id: String(plugin.id || repo || plugin.name || ''),
    name: String(plugin.name || plugin.displayName || repo || '未命名插件'),
    repo,
    description: String(plugin.description || plugin.summary || ''),
    stars: plugin.stars ?? plugin.stargazers_count,
    language: plugin.language || plugin.primaryLanguage,
    license: license || undefined,
    compatibility: plugin.compatibility || plugin.compatible,
    homepage: String(plugin.homepage || plugin.html_url || plugin.url || (typeof plugin.repository === 'string' ? plugin.repository : '') || ''),
    verified: plugin.verified === true,
  };
}

function jsonResponse(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return value; }, async arrayBuffer() { return Buffer.from(JSON.stringify(value)); } };
}

class MarketplaceService {
  constructor({ app, logger, getWorkspace, getDshHome, dshHome, profileDir, profileRoot, getProfileDir, verifiedAllowlist, fetchImpl, execFileImpl, clock, progress, tarCommand, maxArchiveBytes } = {}) {
    this.app = app || { getPath: () => os.tmpdir() };
    this.logger = logger || { info() {}, warn() {}, error() {} };
    this.getWorkspace = getWorkspace || (() => process.cwd());
    this.getDshHome = getDshHome || (() => dshHome || path.join(this.getWorkspace(), '.dsh'));
    this.profileDirOption = profileDir || profileRoot;
    this.getProfileDir = typeof getProfileDir === 'function' ? getProfileDir : null;
    this.allowlist = normalizeAllowlist(verifiedAllowlist);
    this.fetchImpl = fetchImpl || ((url, options) => fetch(url, options));
    this.execFileImpl = execFileImpl || ((file, args, options) => execFileAsync(file, args, options));
    this.clock = clock || (() => Date.now());
    this.progress = typeof progress === 'function' ? progress : () => {};
    this.tarCommand = tarCommand || (process.platform === 'win32' ? 'tar.exe' : 'tar');
    this.maxArchiveBytes = Math.max(1, Number(maxArchiveBytes) || MAX_ARCHIVE_BYTES);
  }

  getProfileRoot() {
    const dshHome = path.resolve(this.getDshHome());
    const configuredProfile = this.getProfileDir ? this.getProfileDir() : this.profileDirOption;
    const profile = configuredProfile ? (path.isAbsolute(configuredProfile) ? path.resolve(configuredProfile) : path.resolve(dshHome, configuredProfile)) : path.join(dshHome, 'profile');
    const checked = within(dshHome, path.relative(dshHome, profile));
    return checked.absolute;
  }

  getPluginRoot() { return within(this.getProfileRoot(), 'plugins').absolute; }
  getTempRoot() { return within(this.getProfileRoot(), '.marketplace-tmp').absolute; }

  async rpcSafeLog(action, repo, extra = '') {
    this.logger.info(redact(`marketplace ${action} ${repo || 'unknown'}${extra ? ` ${extra}` : ''}`));
  }

  async listInstalled() {
    const root = this.getPluginRoot();
    try { await fsp.mkdir(root, { recursive: true }); } catch (error) { throw failure('PROFILE_UNAVAILABLE', `无法创建插件 Profile: ${error.code || error.message}`); }
    const items = [];
    let entries;
    try { entries = await fsp.readdir(root, { withFileTypes: true }); } catch (error) { throw failure('PROFILE_UNAVAILABLE', `无法读取插件 Profile: ${error.code || error.message}`); }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const folder = within(root, entry.name).absolute;
      try {
        await rejectSymlinks(folder);
        const metadata = await readJsonIfExists(path.join(folder, 'marketplace.json'), 128 * 1024);
        const found = metadata || await findManifest(folder);
        if (!found) continue;
        const manifest = metadata?.manifest || found.manifest;
        const plugin = normalizePlugin({ ...(metadata || {}), ...manifest, id: metadata?.id || metadata?.repo || manifest.name, repo: metadata?.repo || manifest.repo, license: manifest.license, path: path.relative(this.getProfileRoot(), folder), status: 'installed', verified: metadata?.verified === true });
        plugin.status = 'installed'; plugin.installedPath = path.relative(this.getProfileRoot(), folder); items.push(plugin);
      } catch (error) {
        this.logger.warn(redact(`marketplace ignored invalid plugin ${entry.name}: ${error.code || error.message}`));
      }
    }
    return { plugins: items };
  }

  async searchMarketplace({ query = '' } = {}) {
    const needle = String(query || '').trim().slice(0, 160);
    const githubQuery = needle ? `${needle} in:name,description,readme` : 'topic:deepseek-harness-plugin';
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(githubQuery)}&per_page=30`;
    const response = await this.request(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DeepSeek-Harness-Desktop' } });
    const body = await response.json();
    const items = Array.isArray(body?.items) ? body.items : [];
    const plugins = items.map((item) => {
      const plugin = normalizePlugin({ ...item, repo: item.full_name, homepage: item.html_url, license: item.license, stars: item.stargazers_count });
      const allow = plugin.repo ? this.allowlist.get(plugin.repo) : undefined;
      // Never trust a remote `verified` flag.  Verification is a local policy
      // decision and is true only for an exact repository in our pinned
      // allowlist; GitHub metadata is otherwise treated as untrusted display
      // data.
      plugin.verified = Boolean(allow);
      if (allow) { plugin.compatibility = allow.compatibility || plugin.compatibility; plugin.verifiedRef = allow.ref; }
      return plugin;
    });
    return { plugins, total: Number.isFinite(Number(body?.total_count)) ? Number(body.total_count) : null };
  }

  async inspectPlugin(input = {}) {
    let plugin = normalizePlugin(input.plugin || input);
    const repo = plugin.repo || normalizeRepo(input.id);
    if (!plugin.repo && repo) plugin.repo = repo;
    if (repo && (!plugin.description || !plugin.license)) {
      try {
        const response = await this.request(`https://api.github.com/repos/${repo}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DeepSeek-Harness-Desktop' } });
        const remote = await response.json(); plugin = normalizePlugin({ ...remote, ...plugin, repo });
      } catch { /* details already available locally */ }
    }
    const allow = repo ? this.allowlist.get(repo) : undefined;
    const verified = Boolean(allow);
    return { plugin: { ...plugin, repo, verified, installable: verified, installReason: verified ? '来源在本地 verified allowlist 中，安装时仍会校验 bundle manifest。' : '来源未在本地 verified allowlist 中，只允许查看。', verifiedRef: allow?.ref || undefined } };
  }

  async installPlugin(input = {}) {
    const candidate = normalizePlugin(input.plugin || input);
    const repo = candidate.repo || normalizeRepo(input.id);
    const allow = repo ? this.allowlist.get(repo) : undefined;
    if (!allow) throw failure('UNVERIFIED_SOURCE', '未知来源插件禁止一键安装；请先加入明确的 verified allowlist');
    const candidateLicense = normalizeLicense(candidate.license || allow.license);
    if (candidateLicense && !isPermissiveLicense(candidateLicense)) throw failure('LICENSE_NOT_ALLOWED', '插件许可证不是允许的宽松许可证');
    const ref = String(allow.ref || '').trim();
    if (!ref) throw failure('ALLOWLIST_INVALID', 'verified allowlist 缺少固定 ref');
    const pluginId = candidate.id || repo;
    const pluginRoot = this.getPluginRoot();
    await fsp.mkdir(pluginRoot, { recursive: true });
    const existing = await this.findInstalled({ id: pluginId, repo });
    if (existing) throw failure('ALREADY_INSTALLED', '插件已经安装');
    const tempRoot = within(this.getTempRoot(), `${safeSegment(repo.replace('/', '--'))}-${crypto.randomBytes(4).toString('hex')}`).absolute;
    const archivePath = path.join(tempRoot, 'source.zip'); const extractRoot = path.join(tempRoot, 'extract');
    let installStage;
    this.progress({ id: pluginId, repo, status: 'downloading', percent: 3 }); await this.rpcSafeLog('download', repo, `ref=${ref}`);
    try {
      await fsp.mkdir(extractRoot, { recursive: true });
      const archiveUrl = allow.archiveUrl || `https://codeload.github.com/${repo}/zip/${encodeURIComponent(ref)}`;
      const response = await this.request(archiveUrl, { headers: { Accept: 'application/zip', 'User-Agent': 'DeepSeek-Harness-Desktop' } });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0 || bytes.length > this.maxArchiveBytes) throw failure('ARCHIVE_TOO_LARGE', '插件归档超过安全大小限制');
      await fsp.writeFile(archivePath, bytes, { flag: 'wx' });
      this.progress({ id: pluginId, repo, status: 'extracting', percent: 20 });
      const listing = await this.execFileImpl(this.tarCommand, ['-tf', archivePath], { windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
      validateArchiveListing(String(listing?.stdout || ''));
      await this.execFileImpl(this.tarCommand, ['-xf', archivePath, '-C', extractRoot], { windowsHide: true, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
      await rejectSymlinks(extractRoot);
      const found = await findManifest(extractRoot);
      if (!found) throw failure('INVALID_MANIFEST', '插件归档没有 dsh bundle manifest');
      const manifest = validateManifest(found.raw, { bundleRoot: found.bundleRoot, expectedRepo: repo, expectedLicense: allow.license });
      await assertEntryFile(found.bundleRoot, manifest.entry);
      const destinationName = safeSegment(`${repo.replace('/', '--')}--${manifest.name}`);
      const destination = within(pluginRoot, destinationName).absolute;
      try { await fsp.lstat(destination); throw failure('ALREADY_INSTALLED', '插件目标目录已经存在'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await rejectSymlinks(found.bundleRoot);
      this.progress({ id: pluginId, repo, status: 'installing', percent: 55 });
      installStage = within(pluginRoot, `.${destinationName}.install-${crypto.randomBytes(4).toString('hex')}`).absolute;
      await copyTreeNoLinks(found.bundleRoot, installStage);
      const metadata = { id: repo, repo, name: manifest.name, version: manifest.version, verified: true, ref, installedAt: new Date(this.clock()).toISOString(), manifest, source: 'github-allowlist' };
      await fsp.writeFile(path.join(installStage, 'marketplace.json'), JSON.stringify(metadata, null, 2), { flag: 'wx' });
      await fsp.rename(installStage, destination);
      this.progress({ id: pluginId, repo, status: 'installed', percent: 100 }); await this.rpcSafeLog('installed', repo, `ref=${ref}`);
      return { ok: true, status: '插件已安装', plugin: normalizePlugin({ ...metadata, status: 'installed', path: path.relative(this.getProfileRoot(), destination) }) };
    } catch (error) {
      this.progress({ id: pluginId, repo, status: 'failed', percent: 0, error: redact(error.message) });
      this.logger.warn(redact(`marketplace install failed ${repo}: ${error.code || error.message}`));
      throw error;
    } finally {
      if (installStage) await fsp.rm(installStage, { recursive: true, force: true }).catch(() => {});
      await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  async uninstallPlugin(input = {}) {
    const candidate = normalizePlugin(input.plugin || input);
    const installed = await this.findInstalled({ id: input.id || candidate.id, repo: candidate.repo || input.repo });
    if (!installed) throw failure('NOT_INSTALLED', '找不到要卸载的插件');
    const profileRoot = this.getProfileRoot();
    const target = within(profileRoot, installed.installedPath).absolute;
    if (!target.startsWith(`${path.resolve(profileRoot)}${path.sep}`)) throw failure('PATH_OUTSIDE_PROFILE', '拒绝删除 Profile 外的路径');
    await rejectSymlinks(target);
    await fsp.rm(target, { recursive: true, force: false });
    await this.rpcSafeLog('uninstalled', installed.repo || installed.id);
    return { ok: true, status: '插件已卸载', id: installed.id };
  }

  async openPluginFolder(input = {}) {
    const candidate = normalizePlugin(input.plugin || input);
    const installed = await this.findInstalled({ id: input.id || candidate.id, repo: candidate.repo || input.repo });
    if (!installed) throw failure('NOT_INSTALLED', '找不到插件目录');
    return { ok: true, path: installed.installedPath, absolutePath: within(this.getProfileRoot(), installed.installedPath).absolute };
  }

  async findInstalled({ id, repo } = {}) {
    const list = await this.listInstalled(); const idText = String(id || ''); const repoText = normalizeRepo(repo || idText);
    return list.plugins.find((plugin) => (repoText && plugin.repo === repoText) || (idText && plugin.id === idText) || (idText && plugin.name === idText));
  }

  async request(url, options = {}) {
    let response;
    try { response = await this.fetchImpl(url, { ...options, signal: options.signal || AbortSignal.timeout(20_000) }); }
    catch (error) { throw failure('NETWORK_ERROR', `插件市场请求失败: ${redact(error.message || error)}`); }
    if (!response || response.ok === false || (response.status !== undefined && response.status >= 400)) throw failure('NETWORK_ERROR', `插件市场请求失败: HTTP ${response?.status || 'unknown'}`);
    return response;
  }
}

async function readJsonIfExists(file, maxBytes = MAX_MANIFEST_BYTES) {
  try {
    const stat = await fsp.stat(file); if (stat.size > maxBytes) throw failure('INVALID_MANIFEST', 'manifest 文件过大');
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function rejectSymlinks(root) {
  let count = 0; let bytes = 0;
  const walk = async (dir, depth) => {
    if (depth > MAX_DEPTH) throw failure('ARCHIVE_UNSAFE', '插件目录层级过深');
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (++count > MAX_FILES) throw failure('ARCHIVE_UNSAFE', '插件归档文件数量超过限制');
      const absolute = path.join(dir, entry.name); const stat = await fsp.lstat(absolute);
      if (stat.isSymbolicLink()) throw failure('ARCHIVE_UNSAFE', '插件归档禁止包含符号链接');
      if (stat.isFile()) { bytes += stat.size; if (bytes > MAX_EXTRACTED_BYTES) throw failure('ARCHIVE_TOO_LARGE', '插件解压后超过安全大小限制'); }
      if (stat.isDirectory()) await walk(absolute, depth + 1);
    }
  };
  await walk(root, 0);
  return true;
}

function validateArchiveListing(listing) {
  for (const rawLine of String(listing || '').split(/\r?\n/)) {
    const entry = rawLine.trim().replace(/\\/g, '/').replace(/\/$/, '');
    if (!entry) continue;
    if (entry.includes('\0') || entry.startsWith('/') || /^[A-Za-z]:\//.test(entry)) throw failure('ARCHIVE_UNSAFE', '插件归档包含绝对路径');
    if (entry.split('/').some((part) => part === '..' || part === '')) throw failure('ARCHIVE_UNSAFE', '插件归档包含路径穿越');
  }
  return true;
}

async function copyTreeNoLinks(source, destination) {
  await fsp.mkdir(destination, { recursive: true });
  const entries = await fsp.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'marketplace.json') continue;
    const sourcePath = path.join(source, entry.name); const destinationPath = path.join(destination, entry.name); const stat = await fsp.lstat(sourcePath);
    if (stat.isSymbolicLink()) throw failure('ARCHIVE_UNSAFE', '插件归档禁止包含符号链接');
    if (stat.isDirectory()) await copyTreeNoLinks(sourcePath, destinationPath); else if (stat.isFile()) await fsp.copyFile(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL); else throw failure('ARCHIVE_UNSAFE', '插件归档包含不支持的文件类型');
  }
}

async function assertEntryFile(bundleRoot, entry) {
  const checked = within(bundleRoot, entry);
  const stat = await fsp.lstat(checked.absolute).catch((error) => { throw failure('INVALID_MANIFEST', `插件 entry 不存在: ${entry}`, error.code); });
  if (!stat.isFile() || stat.isSymbolicLink()) throw failure('INVALID_MANIFEST', '插件 entry 必须是普通文件');
  return checked.absolute;
}

async function findManifest(root) {
  const queue = [{ dir: root, depth: 0 }]; let inspected = 0;
  const candidates = [];
  while (queue.length) {
    const current = queue.shift(); const entries = await fsp.readdir(current.dir, { withFileTypes: true });
    for (const entry of entries) {
      if (++inspected > MAX_FILES) throw failure('ARCHIVE_UNSAFE', '插件归档文件数量超过限制');
      const absolute = path.join(current.dir, entry.name);
      if (entry.isDirectory() && current.depth < MAX_DEPTH) queue.push({ dir: absolute, depth: current.depth + 1 });
      else if (entry.isFile() && MANIFEST_NAMES.includes(entry.name.toLowerCase())) candidates.push(absolute);
    }
  }
  candidates.sort((a, b) => MANIFEST_NAMES.indexOf(path.basename(a).toLowerCase()) - MANIFEST_NAMES.indexOf(path.basename(b).toLowerCase()));
  for (const manifestPath of candidates) {
    try {
      const raw = await readJsonIfExists(manifestPath); const payload = manifestPayload(raw);
      if (!payload || (!payload.dsh && !payload.deepseekHarness && !MANIFEST_KINDS.has(String(payload.kind || payload.type || '').toLowerCase()) && payload.api !== 'dsh')) continue;
      return { raw, manifestPath, bundleRoot: path.dirname(manifestPath), manifest: payload };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return null;
}

module.exports = {
  MarketplaceService,
  MarketplaceError,
  DEFAULT_PROFILE_RELATIVE,
  MAX_ARCHIVE_BYTES,
  PERMISSIVE_LICENSES,
  normalizeRepo,
  normalizePlugin,
  normalizeLicense,
  normalizeAllowlist,
  isPermissiveLicense,
  validateManifest,
  safeRelativeEntry,
  within,
  findManifest,
  validateArchiveListing,
  jsonResponse,
};
