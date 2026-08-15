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

module.exports = { SecureStore, DEFAULTS, maskSecret, normalizeURL, normalizeModel };
