const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const test = require('node:test');
const {
  MarketplaceError,
  MarketplaceService,
  isPermissiveLicense,
  jsonResponse,
  normalizeRepo,
  safeRelativeEntry,
  validateArchiveListing,
  validateManifest,
  within,
} = require('../src/marketplace-service.cjs');

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-marketplace-'));
  const workspace = path.join(root, 'workspace');
  const dshHome = path.join(root, 'dsh-home');
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(dshHome, { recursive: true });
  const logs = [];
  const logger = { info: (value) => logs.push(String(value)), warn: (value) => logs.push(String(value)), error: (value) => logs.push(String(value)), file: path.join(root, 'desktop.log') };
  const cleanup = () => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  return { root, workspace, dshHome, logger, logs, cleanup };
}

function allowlist() {
  return {
    'acme/vision-plugin': { verified: true, ref: '0123456789abcdef0123456789abcdef01234567', license: 'MIT', compatibility: 'dsh >= 0.1' },
  };
}

function validManifest() {
  return { kind: 'dsh-plugin', name: 'vision-plugin', version: '1.2.3', entry: 'index.js', license: 'MIT', repo: 'acme/vision-plugin', permissions: ['workspace.read'] };
}

function responseWithArchive() {
  return { ok: true, status: 200, async arrayBuffer() { return Buffer.from('test-archive'); }, async json() { return {}; } };
}

function fakeExtractor(manifest = validManifest()) {
  return async (_file, args) => {
    if (args.some((arg) => arg === '-t' || arg === '-tf')) return { stdout: 'vision-plugin-0123456/\nvision-plugin-0123456/dsh-plugin.json\nvision-plugin-0123456/index.js\n', stderr: '' };
    const extractRoot = args[args.indexOf('-C') + 1];
    const bundle = path.join(extractRoot, 'vision-plugin-0123456');
    await fs.mkdir(bundle, { recursive: true });
    await fs.writeFile(path.join(bundle, 'dsh-plugin.json'), JSON.stringify(manifest), 'utf8');
    await fs.writeFile(path.join(bundle, manifest.entry), 'export default { name: "vision-plugin" };\n', 'utf8');
    return { stdout: '', stderr: '' };
  };
}

test('marketplace normalizes GitHub repos, confines paths, and accepts only permissive licenses', () => {
  assert.equal(normalizeRepo('https://github.com/Acme/Vision-Plugin.git'), 'acme/vision-plugin');
  assert.equal(normalizeRepo('git@github.com:Acme/Vision-Plugin.git'), 'acme/vision-plugin');
  assert.equal(normalizeRepo('https://example.com/acme/plugin'), null);
  assert.equal(safeRelativeEntry('dist/index.js'), path.join('dist', 'index.js'));
  assert.equal(safeRelativeEntry('../outside.js'), null);
  assert.equal(safeRelativeEntry('/absolute.js'), null);
  assert.equal(isPermissiveLicense('MIT'), true);
  assert.equal(isPermissiveLicense('Apache-2.0'), true);
  assert.equal(isPermissiveLicense('GPL-3.0'), false);
  const root = path.resolve('C:\\profile');
  assert.equal(within(root, 'plugins\\one').relative, path.join('plugins', 'one'));
  assert.throws(() => within(root, '..\\outside'), (error) => error.code === 'PATH_OUTSIDE_PROFILE');
  assert.equal(validateArchiveListing('bundle/index.js\nbundle/dsh-plugin.json\n'), true);
  assert.throws(() => validateArchiveListing('../outside.js\n'), (error) => error.code === 'ARCHIVE_UNSAFE');
  assert.throws(() => validateArchiveListing('/absolute.js\n'), (error) => error.code === 'ARCHIVE_UNSAFE');
});

test('searchMarketplace exposes public GitHub metadata but only local allowlist entries are verified', async (t) => {
  const x = await fixture(); t.after(x.cleanup);
  let requested;
  const service = new MarketplaceService({
    getWorkspace: () => x.workspace,
    getDshHome: () => x.dshHome,
    verifiedAllowlist: allowlist(),
    logger: x.logger,
    fetchImpl: async (url) => { requested = url; return jsonResponse({ total_count: 2, items: [
      // A remote field must never be able to self-assert verification.
      { full_name: 'unknown/random-plugin', name: 'random-plugin', description: 'Unknown', stargazers_count: 3, license: { spdx_id: 'MIT' }, html_url: 'https://github.com/unknown/random-plugin', verified: true },
      { full_name: 'acme/vision-plugin', name: 'vision-plugin', description: 'Verified', stargazers_count: 8, license: { spdx_id: 'MIT' }, html_url: 'https://github.com/acme/vision-plugin' },
    ] }); },
  });
  const result = await service.searchMarketplace({ query: 'vision' });
  assert.match(requested, /api\.github\.com\/search\/repositories/);
  assert.equal(result.total, 2);
  assert.equal(result.plugins.length, 2);
  assert.equal(result.plugins.find((item) => item.repo === 'unknown/random-plugin').verified, false);
  assert.equal(result.plugins.find((item) => item.repo === 'acme/vision-plugin').verified, true);
});

test('empty marketplace search uses a bounded public topic query instead of inventing recommendations', async (t) => {
  const x = await fixture(); t.after(x.cleanup);
  let requested;
  const service = new MarketplaceService({ getWorkspace: () => x.workspace, getDshHome: () => x.dshHome, logger: x.logger, fetchImpl: async (url) => { requested = url; return jsonResponse({ total_count: 0, items: [] }); } });
  const result = await service.searchMarketplace({ query: '' });
  assert.match(requested, /topic%3Adeepseek-harness-plugin/);
  assert.deepEqual(result.plugins, []);
  assert.equal(result.total, 0);
});

test('unknown repository cannot trigger download or extraction', async (t) => {
  const x = await fixture(); t.after(x.cleanup);
  let fetchCalled = false; let execCalled = false;
  const service = new MarketplaceService({ getWorkspace: () => x.workspace, getDshHome: () => x.dshHome, logger: x.logger, verifiedAllowlist: allowlist(), fetchImpl: async () => { fetchCalled = true; return responseWithArchive(); }, execFileImpl: async () => { execCalled = true; } });
  await assert.rejects(() => service.installPlugin({ plugin: { repo: 'unknown/random-plugin', verified: true, license: 'MIT' } }), (error) => error instanceof MarketplaceError && error.code === 'UNVERIFIED_SOURCE');
  assert.equal(fetchCalled, false);
  assert.equal(execCalled, false);
});

test('verified installation requires pinned ref, permissive license and legal dsh manifest, then stays inside Profile', async (t) => {
  const x = await fixture(); t.after(x.cleanup);
  const progress = [];
  const service = new MarketplaceService({
    getWorkspace: () => x.workspace,
    getDshHome: () => x.dshHome,
    verifiedAllowlist: allowlist(),
    logger: x.logger,
    fetchImpl: async () => responseWithArchive(),
    execFileImpl: fakeExtractor(),
    progress: (event) => progress.push(event),
    clock: () => Date.parse('2026-08-15T12:00:00.000Z'),
  });
  const result = await service.installPlugin({ plugin: { repo: 'acme/vision-plugin', name: 'vision-plugin', verified: true, license: 'MIT' } });
  assert.equal(result.ok, true);
  assert.equal(result.plugin.verified, true);
  assert.equal(progress.at(-1).percent, 100);
  const installed = await service.listInstalled();
  assert.equal(installed.plugins.length, 1);
  assert.equal(installed.plugins[0].repo, 'acme/vision-plugin');
  assert.equal(installed.plugins[0].status, 'installed');
  assert.equal(installed.plugins[0].installedPath.startsWith(path.join('plugins', '')), true);
  const folder = await service.openPluginFolder({ id: 'acme/vision-plugin' });
  assert.equal(path.basename(folder.absolutePath).includes('acme--vision-plugin'), true);
  assert.equal(folder.absolutePath.startsWith(service.getPluginRoot()), true);
  await assert.rejects(() => service.installPlugin({ plugin: { repo: 'acme/vision-plugin', verified: true, license: 'MIT' } }), (error) => error.code === 'ALREADY_INSTALLED');
  const uninstall = await service.uninstallPlugin({ id: 'acme/vision-plugin' });
  assert.equal(uninstall.ok, true);
  assert.equal((await service.listInstalled()).plugins.length, 0);
  assert.ok(x.logs.every((line) => !line.includes('sk-') && !line.includes('Bearer')));
});

test('verified install rejects a non-permissive or malformed bundle before copying', async (t) => {
  const x = await fixture(); t.after(x.cleanup);
  const badLicenseService = new MarketplaceService({ getWorkspace: () => x.workspace, getDshHome: () => x.dshHome, verifiedAllowlist: allowlist(), logger: x.logger, fetchImpl: async () => responseWithArchive(), execFileImpl: fakeExtractor({ ...validManifest(), license: 'GPL-3.0' }) });
  await assert.rejects(() => badLicenseService.installPlugin({ plugin: { repo: 'acme/vision-plugin', verified: true } }), (error) => error.code === 'LICENSE_NOT_ALLOWED' || error.code === 'LICENSE_MISMATCH');
  assert.equal((await badLicenseService.listInstalled()).plugins.length, 0);
  const badManifestService = new MarketplaceService({ getWorkspace: () => x.workspace, getDshHome: () => path.join(x.root, 'dsh-other'), verifiedAllowlist: allowlist(), logger: x.logger, fetchImpl: async () => responseWithArchive(), execFileImpl: fakeExtractor({ ...validManifest(), kind: 'random-package', entry: '../escape.js' }) });
  await assert.rejects(() => badManifestService.installPlugin({ plugin: { repo: 'acme/vision-plugin', verified: true } }), (error) => error.code === 'INVALID_MANIFEST');
  assert.equal((await badManifestService.listInstalled()).plugins.length, 0);
});

test('inspectPlugin never upgrades an unknown repository to installable', async (t) => {
  const x = await fixture(); t.after(x.cleanup);
  const service = new MarketplaceService({ getWorkspace: () => x.workspace, getDshHome: () => x.dshHome, verifiedAllowlist: allowlist(), logger: x.logger, fetchImpl: async () => jsonResponse({ full_name: 'unknown/random-plugin', name: 'random-plugin', license: { spdx_id: 'MIT' }, html_url: 'https://github.com/unknown/random-plugin' }) });
  const result = await service.inspectPlugin({ plugin: { repo: 'unknown/random-plugin', name: 'random-plugin' } });
  assert.equal(result.plugin.verified, false);
  assert.equal(result.plugin.installable, false);
  assert.match(result.plugin.installReason, /allowlist/);
});
