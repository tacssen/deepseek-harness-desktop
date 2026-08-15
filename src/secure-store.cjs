/**
 * Small settings/secret store for the desktop shell.
 *
 * Non-secret preferences are JSON. API keys are encrypted with Electron's
 * safeStorage (Windows DPAPI-backed) and are never returned to a renderer,
 * printed, or put in the Harness settings document. If DPAPI is unavailable,
 * writes containing a secret are rejected instead of silently falling back to
 * plaintext.
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { normalizeAgentLevel, DEFAULT_AGENT_LEVEL } = require('./agent-levels.cjs');

const DEFAULTS = Object.freeze({
  deepseek: {
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
  },
  vision: {
    enabled: false,
    provider: 'siliconflow',
    baseURL: 'https://api.siliconflow.cn/v1/chat/completions',
    model: 'zai-org/GLM-4.5V',
  },
  workspace: {
    path: '',
    allowShell: true,
  },
  debug: {
    enabled: false,
  },
  general: {
    launchBehavior: 'restore',
    startOnBoot: false,
    closeToTray: false,
    restoreWorkspace: true,
    enterBehavior: 'send',
    defaultPreset: 'deepseek-desktop',
    autoUpdateCheck: true,
    restoreSession: true,
    downloadDir: '',
    tempDir: '',
  },
  appearance: {
    theme: 'dark',
    scale: 100,
    fontSize: 14,
    compact: false,
    sidebarDensity: 'comfortable',
    animations: true,
    codeFont: 'Cascadia Code, Consolas, monospace',
    editorFont: 'Segoe UI, system-ui, sans-serif',
  },
  personalization: {
    globalInstructions: '',
    workspaceInstructions: '',
    language: 'zh-CN',
    commentLanguage: 'same-as-code',
    codingStyle: 'pragmatic',
    preferExplain: true,
    autoTest: true,
    autoSummary: true,
  },
  agent: {
    level: DEFAULT_AGENT_LEVEL,
    budgetOverride: 0,
  },
  permissions: {
    preset: 'safe-coding',
    workspaceWrite: true,
    terminal: true,
    browser: false,
    computer: false,
    confirmDestructive: true,
  },
  browser: {
    enabled: false,
    headless: false,
    executable: '',
    downloadDir: '',
    screenshotQuality: 80,
    allowedDomains: [],
    blockedDomains: [],
    cookiePolicy: 'isolated',
    confirmDownloads: true,
    confirmUploads: true,
  },
  advanced: {
    dynamicPort: true,
    harnessPort: 0,
    startupTimeoutMs: 60000,
    requestTimeoutMs: 20000,
    retry: 2,
    loggingLevel: 'info',
    developerMode: false,
    proxy: '',
  },
});

const PERMISSION_PRESETS = Object.freeze({
  'read-only': Object.freeze({ workspaceWrite: false, terminal: false, browser: false, computer: false }),
  'safe-coding': Object.freeze({ workspaceWrite: true, terminal: true, browser: false, computer: false }),
  'full-workspace': Object.freeze({ workspaceWrite: true, terminal: true, browser: false, computer: false }),
  'browser-agent': Object.freeze({ workspaceWrite: true, terminal: true, browser: true, computer: false }),
  'full-agent': Object.freeze({ workspaceWrite: true, terminal: true, browser: true, computer: false }),
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeDefaults(value) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    deepseek: { ...DEFAULTS.deepseek, ...(input.deepseek || {}) },
    vision: { ...DEFAULTS.vision, ...(input.vision || {}) },
    workspace: { ...DEFAULTS.workspace, ...(input.workspace || {}) },
    debug: { ...DEFAULTS.debug, ...(input.debug || {}) },
    general: { ...DEFAULTS.general, ...(input.general || {}) },
    appearance: { ...DEFAULTS.appearance, ...(input.appearance || {}) },
    personalization: { ...DEFAULTS.personalization, ...(input.personalization || {}) },
    agent: { ...DEFAULTS.agent, ...(input.agent || {}) },
    permissions: { ...DEFAULTS.permissions, ...(input.permissions || {}) },
    browser: { ...DEFAULTS.browser, ...(input.browser || {}) },
    advanced: { ...DEFAULTS.advanced, ...(input.advanced || {}) },
  };
}

function maskSecret(value) {
  return value ? '••••••••' : '';
}

class SecureStore {
  constructor(app, electronSafeStorage, log) {
    this.app = app;
    this.safeStorage = electronSafeStorage;
    this.log = typeof log === 'function' ? log : () => {};
    this.file = path.join(app.getPath('userData'), 'settings.secure.json');
    this.data = null;
    this.secrets = { deepseekApiKey: '', visionApiKey: '' };
  }

  load() {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (error) {
      if (error && error.code !== 'ENOENT') this.log(`settings read failed: ${error.code || 'error'}`);
      raw = {};
    }
    this.data = mergeDefaults(raw.preferences);
    this.secrets = { deepseekApiKey: '', visionApiKey: '' };
    if (raw && raw.secrets && this.safeStorage.isEncryptionAvailable()) {
      for (const name of Object.keys(this.secrets)) {
        const encoded = raw.secrets[name];
        if (!encoded || typeof encoded !== 'string') continue;
        try {
          this.secrets[name] = this.safeStorage.decryptString(Buffer.from(encoded, 'base64'));
        } catch {
          this.log(`settings secret ${name} could not be decrypted; it will be requested again`);
        }
      }
    }
    return this.publicSettings();
  }

  ensureLoaded() {
    if (!this.data) this.load();
  }

  publicSettings() {
    this.ensureLoaded();
    return {
      ...clone(this.data),
      deepseek: {
        ...clone(this.data.deepseek),
        apiKeyConfigured: Boolean(this.secrets.deepseekApiKey),
        apiKeyMasked: maskSecret(this.secrets.deepseekApiKey),
      },
      vision: {
        ...clone(this.data.vision),
        apiKeyConfigured: Boolean(this.secrets.visionApiKey),
        apiKeyMasked: maskSecret(this.secrets.visionApiKey),
        status: this.data.vision.enabled
          ? (this.secrets.visionApiKey ? 'Vision Ready' : 'Awaiting API Key')
          : 'Vision Disabled',
      },
    };
  }

  getSecret(name) {
    this.ensureLoaded();
    if (!(name in this.secrets)) throw new Error('unknown secret');
    return this.secrets[name] || '';
  }

  getPreferences() {
    this.ensureLoaded();
    return clone(this.data);
  }

  async save(input) {
    this.ensureLoaded();
    const value = input && typeof input === 'object' ? input : {};
    const preferences = mergeDefaults({
      ...this.data,
      deepseek: { ...this.data.deepseek, ...(value.deepseek || {}) },
      vision: { ...this.data.vision, ...(value.vision || {}) },
      workspace: { ...this.data.workspace, ...(value.workspace || {}) },
      debug: { ...this.data.debug, ...(value.debug || {}) },
      general: { ...this.data.general, ...(value.general || {}) },
      appearance: { ...this.data.appearance, ...(value.appearance || {}) },
      personalization: { ...this.data.personalization, ...(value.personalization || {}) },
      agent: { ...this.data.agent, ...(value.agent || {}) },
      permissions: { ...this.data.permissions, ...(value.permissions || {}) },
      browser: { ...this.data.browser, ...(value.browser || {}) },
      advanced: { ...this.data.advanced, ...(value.advanced || {}) },
    });
    // Keep URLs and model IDs deliberately narrow; these values become child
    // process environment/config, so do not accept arbitrary object shapes.
    preferences.deepseek.baseURL = normalizeURL(preferences.deepseek.baseURL, 'deepseek base URL');
    preferences.deepseek.model = normalizeModel(preferences.deepseek.model, 'deepseek model');
    preferences.vision.baseURL = normalizeURL(preferences.vision.baseURL, 'vision base URL');
    preferences.vision.model = normalizeModel(preferences.vision.model, 'vision model');
    preferences.vision.provider = ['siliconflow', 'bigmodel'].includes(preferences.vision.provider) ? preferences.vision.provider : 'siliconflow';
    preferences.vision.enabled = Boolean(preferences.vision.enabled);
    preferences.workspace.allowShell = Boolean(preferences.workspace.allowShell);
    preferences.workspace.path = typeof preferences.workspace.path === 'string' ? preferences.workspace.path : '';
    preferences.debug.enabled = Boolean(preferences.debug.enabled);
    preferences.agent.level = normalizeAgentLevel(preferences.agent.level);
    preferences.agent.budgetOverride = Math.max(0, Math.min(200, Number(preferences.agent.budgetOverride) || 0));
    preferences.general.launchBehavior = ['restore', 'new', 'tray'].includes(preferences.general.launchBehavior) ? preferences.general.launchBehavior : 'restore';
    preferences.general.enterBehavior = ['send', 'newline'].includes(preferences.general.enterBehavior) ? preferences.general.enterBehavior : 'send';
    preferences.general.startOnBoot = Boolean(preferences.general.startOnBoot);
    preferences.general.closeToTray = Boolean(preferences.general.closeToTray);
    preferences.general.restoreWorkspace = preferences.general.restoreWorkspace !== false;
    preferences.general.autoUpdateCheck = preferences.general.autoUpdateCheck !== false;
    preferences.general.restoreSession = preferences.general.restoreSession !== false;
    preferences.general.defaultPreset = normalizePreset(preferences.general.defaultPreset);
    preferences.general.downloadDir = normalizeOptionalPath(preferences.general.downloadDir);
    preferences.general.tempDir = normalizeOptionalPath(preferences.general.tempDir);
    preferences.appearance.theme = ['dark', 'light', 'system'].includes(preferences.appearance.theme) ? preferences.appearance.theme : 'dark';
    preferences.appearance.scale = Math.max(75, Math.min(150, Number(preferences.appearance.scale) || 100));
    preferences.appearance.fontSize = Math.max(11, Math.min(22, Number(preferences.appearance.fontSize) || 14));
    preferences.appearance.sidebarDensity = ['compact', 'comfortable'].includes(preferences.appearance.sidebarDensity) ? preferences.appearance.sidebarDensity : 'comfortable';
    preferences.appearance.compact = Boolean(preferences.appearance.compact);
    preferences.appearance.animations = preferences.appearance.animations !== false;
    preferences.appearance.codeFont = normalizeShortText(preferences.appearance.codeFont, DEFAULTS.appearance.codeFont, 160);
    preferences.appearance.editorFont = normalizeShortText(preferences.appearance.editorFont, DEFAULTS.appearance.editorFont, 160);
    preferences.personalization.language = normalizeShortText(preferences.personalization.language, 'zh-CN', 40);
    preferences.personalization.commentLanguage = normalizeShortText(preferences.personalization.commentLanguage, 'same-as-code', 80);
    preferences.personalization.codingStyle = normalizeShortText(preferences.personalization.codingStyle, 'pragmatic', 120);
    preferences.personalization.globalInstructions = normalizeLongText(preferences.personalization.globalInstructions, 12000);
    preferences.personalization.workspaceInstructions = normalizeLongText(preferences.personalization.workspaceInstructions, 12000);
    preferences.permissions.preset = ['read-only', 'safe-coding', 'full-workspace', 'browser-agent', 'full-agent'].includes(preferences.permissions.preset) ? preferences.permissions.preset : 'safe-coding';
    // Presets are the canonical permission policy.  Computer control remains
    // deferred, so even Full Agent cannot silently enable desktop control.
    Object.assign(preferences.permissions, PERMISSION_PRESETS[preferences.permissions.preset]);
    preferences.permissions.confirmDestructive = preferences.permissions.confirmDestructive !== false;
    preferences.permissions.computer = false;
    preferences.browser.enabled = Boolean(preferences.browser.enabled);
    preferences.browser.headless = Boolean(preferences.browser.headless);
    preferences.browser.executable = normalizeOptionalPath(preferences.browser.executable);
    preferences.browser.downloadDir = normalizeOptionalPath(preferences.browser.downloadDir);
    preferences.browser.screenshotQuality = Math.max(20, Math.min(100, Number(preferences.browser.screenshotQuality) || 80));
    preferences.browser.allowedDomains = normalizeDomains(preferences.browser.allowedDomains);
    preferences.browser.blockedDomains = normalizeDomains(preferences.browser.blockedDomains);
    preferences.browser.cookiePolicy = ['isolated', 'none', 'user-profile'].includes(preferences.browser.cookiePolicy) ? preferences.browser.cookiePolicy : 'isolated';
    preferences.browser.confirmDownloads = preferences.browser.confirmDownloads !== false;
    preferences.browser.confirmUploads = preferences.browser.confirmUploads !== false;
    preferences.advanced.dynamicPort = Boolean(preferences.advanced.dynamicPort);
    preferences.advanced.harnessPort = Math.max(0, Math.min(65535, Number(preferences.advanced.harnessPort) || 0));
    preferences.advanced.startupTimeoutMs = Math.max(10000, Math.min(180000, Number(preferences.advanced.startupTimeoutMs) || 60000));
    preferences.advanced.requestTimeoutMs = Math.max(5000, Math.min(120000, Number(preferences.advanced.requestTimeoutMs) || 20000));
    preferences.advanced.retry = Math.max(0, Math.min(5, Number(preferences.advanced.retry) || 0));
    preferences.advanced.loggingLevel = ['error', 'warn', 'info', 'debug'].includes(preferences.advanced.loggingLevel) ? preferences.advanced.loggingLevel : 'info';
    preferences.advanced.developerMode = Boolean(preferences.advanced.developerMode);
    preferences.advanced.proxy = normalizeURLOrBlank(preferences.advanced.proxy);

    const nextSecrets = { ...this.secrets };
    if (Object.prototype.hasOwnProperty.call(value, 'deepseekApiKey')) {
      if (value.deepseekApiKey === null || value.deepseekApiKey === '') nextSecrets.deepseekApiKey = '';
      else nextSecrets.deepseekApiKey = validateSecret(value.deepseekApiKey, 'DeepSeek API key');
    }
    if (Object.prototype.hasOwnProperty.call(value, 'visionApiKey')) {
      if (value.visionApiKey === null || value.visionApiKey === '') nextSecrets.visionApiKey = '';
      else nextSecrets.visionApiKey = validateSecret(value.visionApiKey, 'Vision API key');
    }
    if ((nextSecrets.deepseekApiKey || nextSecrets.visionApiKey) && !this.safeStorage.isEncryptionAvailable()) {
      throw new Error('Windows DPAPI (Electron safeStorage) is unavailable; refusing to persist an API key as plaintext');
    }
    const encrypted = {};
    for (const [name, secret] of Object.entries(nextSecrets)) {
      if (!secret) continue;
      encrypted[name] = this.safeStorage.encryptString(secret).toString('base64');
    }
    const disk = { version: 1, preferences, secrets: encrypted };
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    await fsp.writeFile(temp, `${JSON.stringify(disk, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fsp.rename(temp, this.file);
    this.data = preferences;
    this.secrets = nextSecrets;
    return this.publicSettings();
  }

  async clearSecrets() {
    return this.save({ deepseekApiKey: null, visionApiKey: null });
  }

  exportProfile() {
    this.ensureLoaded();
    const profile = clone(this.data);
    // A profile is portable preferences only. Never include secrets, DPAPI,
    // cookies, session ids, or machine-specific absolute Workspace paths.
    profile.workspace = { ...profile.workspace, path: '' };
    profile.general = { ...profile.general, downloadDir: '', tempDir: '' };
    profile.browser = { ...profile.browser, executable: '', downloadDir: '' };
    return { schemaVersion: 1, kind: 'deepseek-harness-desktop-profile', exportedAt: new Date().toISOString(), preferences: profile };
  }

  async importProfile(profile) {
    const value = validateProfile(profile);
    return this.save(value.preferences);
  }
}

function normalizeURL(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 500) throw new Error(`${label} is invalid`);
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${label} is invalid`); }
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error(`${label} must use http or https`);
  return value.replace(/\/$/, '');
}

function normalizeModel(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:/-]{1,160}$/.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function validateSecret(value, label) {
  if (typeof value !== 'string' || value.length < 4 || value.length > 4096 || /[\r\n]/.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function normalizeShortText(value, fallback, max) { return typeof value === 'string' && value.length <= max ? value : fallback; }
function normalizeLongText(value, max) { return typeof value === 'string' ? value.slice(0, max) : ''; }
function normalizeOptionalPath(value) { return typeof value === 'string' && value.length <= 1000 ? value : ''; }
function normalizePreset(value) { return typeof value === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(value) ? value : 'deepseek-desktop'; }
function normalizeDomains(value) { return Array.isArray(value) ? value.map((item) => String(item).trim().toLowerCase()).filter((item) => /^[a-z0-9.-]{1,253}$/.test(item)).slice(0, 100) : []; }
function normalizeURLOrBlank(value) { if (!value) return ''; return normalizeURL(value, 'proxy'); }

function validateProfile(profile) {
  if (!profile || typeof profile !== 'object' || profile.kind !== 'deepseek-harness-desktop-profile' || Number(profile.schemaVersion) !== 1) throw new Error('Profile schema is invalid');
  const forbidden = /apiKey|api_key|bearer|token|cookie|dpapi|credential|password|secret/i;
  const visit = (value) => {
    if (!value || typeof value !== 'object') return false;
    for (const [key, child] of Object.entries(value)) {
      if (forbidden.test(key)) return true;
      if (child && typeof child === 'object' && visit(child)) return true;
    }
    return false;
  };
  if (visit(profile)) throw new Error('Profile contains a forbidden secret field');
  if (!profile.preferences || typeof profile.preferences !== 'object') throw new Error('Profile preferences are missing');
  return { preferences: profile.preferences };
}

module.exports = { SecureStore, DEFAULTS, PERMISSION_PRESETS, maskSecret, normalizeURL, normalizeModel, validateProfile };
