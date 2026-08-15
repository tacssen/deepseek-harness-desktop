const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const pricing = require('./pricing-metadata.json');

const SCHEMA_VERSION = 1;
const MAX_USAGE_RECORDS = 20_000;

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function atomicFile(file, value) {
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  return fsp.mkdir(path.dirname(file), { recursive: true })
    .then(() => fsp.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 }))
    .then(() => fsp.rename(temp, file));
}

function emptyState() { return { schemaVersion: SCHEMA_VERSION, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), usage: { records: [] } }; }

function asNumber(value) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : 0; }

function usageCost(provider, model, record) {
  const table = pricing.providers?.[provider]?.models?.[model];
  if (!table) return { estimatedCost: null, currency: pricing.currency };
  const prompt = asNumber(record.promptTokens);
  const output = asNumber(record.completionTokens);
  const cacheHit = asNumber(record.cacheHitTokens);
  const cacheMiss = asNumber(record.cacheMissTokens || Math.max(0, prompt - cacheHit));
  const cost = (output * table.output + cacheHit * table.cacheHit + cacheMiss * table.cacheMiss) / 1_000_000;
  return { estimatedCost: Number(cost.toFixed(8)), currency: pricing.currency };
}

function normalizeUsageRecord(value) {
  const record = value && typeof value === 'object' ? value : {};
  const promptTokens = asNumber(record.promptTokens);
  const completionTokens = asNumber(record.completionTokens);
  const totalTokens = asNumber(record.totalTokens) || promptTokens + completionTokens;
  const provider = String(record.provider || 'unknown').slice(0, 120);
  const model = String(record.model || 'unknown').slice(0, 160);
  const normalized = {
    id: String(record.id || `usage-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`).slice(0, 180),
    eventSeq: record.eventSeq == null ? null : asNumber(record.eventSeq),
    provider, model,
    sessionId: String(record.sessionId || '').slice(0, 180),
    workspace: String(record.workspace || '').slice(0, 500),
    promptTokens, completionTokens, totalTokens,
    reasoningTokens: asNumber(record.reasoningTokens),
    cacheHitTokens: asNumber(record.cacheHitTokens),
    cacheMissTokens: asNumber(record.cacheMissTokens || Math.max(0, promptTokens - asNumber(record.cacheHitTokens))),
    durationMs: asNumber(record.durationMs),
    requestAt: String(record.requestAt || new Date().toISOString()).slice(0, 60),
    source: String(record.source || 'session-event').slice(0, 80),
  };
  return { ...normalized, ...usageCost(provider, model, normalized) };
}

function readUsage(value, key) {
  if (!value || typeof value !== 'object') return 0;
  const snake = key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
  const aliases = {
    promptTokens: ['prompt_tokens', 'input_tokens'],
    completionTokens: ['completion_tokens', 'output_tokens'],
    totalTokens: ['total_tokens'],
    reasoningTokens: ['reasoning_tokens', 'thinking_tokens'],
    cacheHitTokens: ['cache_hit_tokens', 'prompt_cache_hit_tokens', 'cached_tokens'],
    cacheMissTokens: ['cache_miss_tokens', 'prompt_cache_miss_tokens'],
  };
  const details = [value.completion_tokens_details, value.prompt_tokens_details, value.details].filter(Boolean);
  const candidates = [value[key], value[snake], value[key[0].toLowerCase() + key.slice(1)], ...(aliases[key] || [] ).map((name) => value[name]), ...details.flatMap((item) => [item[key], item[snake], ...(aliases[key] || []).map((name) => item[name])])];
  for (const candidate of candidates) if (Number.isFinite(Number(candidate)) && Number(candidate) >= 0) return Number(candidate);
  return 0;
}

class AppDataService {
  constructor(app, logger = { warn() {}, info() {} }) {
    this.app = app;
    this.logger = logger;
    this.root = path.join(app.getPath('userData'), 'data');
    this.file = path.join(this.root, 'app-state.json');
    this.backup = path.join(this.root, 'app-state.backup.json');
    this.state = null;
    this.writeQueue = Promise.resolve();
  }

  load() {
    if (this.state) return clone(this.state);
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.state = this.migrate(raw);
    } catch (error) {
      if (error.code !== 'ENOENT') this.logger.warn(`app data read failed: ${error.code || error.message}`);
      this.state = emptyState();
    }
    return clone(this.state);
  }

  migrate(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const records = Array.isArray(input.usage?.records) ? input.usage.records.map(normalizeUsageRecord).slice(-MAX_USAGE_RECORDS) : [];
    return { schemaVersion: SCHEMA_VERSION, createdAt: String(input.createdAt || new Date().toISOString()), updatedAt: new Date().toISOString(), usage: { records } };
  }

  async persist() {
    this.load();
    this.state.updatedAt = new Date().toISOString();
    const next = clone(this.state);
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        if (fs.existsSync(this.file)) await fsp.copyFile(this.file, this.backup).catch(() => {});
        await atomicFile(this.file, next);
      } catch (error) { this.logger.warn(`app data write failed: ${error.code || error.message}`); throw error; }
    });
    return this.writeQueue;
  }

  async recordUsage(value) {
    this.load();
    const record = normalizeUsageRecord(value);
    const key = record.eventSeq != null && record.sessionId ? `${record.sessionId}:${record.eventSeq}` : record.id;
    const exists = this.state.usage.records.some((entry) => (entry.eventSeq != null && entry.sessionId ? `${entry.sessionId}:${entry.eventSeq}` : entry.id) === key);
    if (!exists) {
      this.state.usage.records.push(record);
      if (this.state.usage.records.length > MAX_USAGE_RECORDS) this.state.usage.records = this.state.usage.records.slice(-MAX_USAGE_RECORDS);
      await this.persist();
    }
    return record;
  }

  async recordSessionEvents(events, { sessionId = '', workspace = '' } = {}) {
    // A request/header normally precedes assistant/message by several event
    // sequence numbers. Keep the latest observed provider context rather than
    // assuming both records share the same seq.
    let currentConfig = {};
    const out = [];
    for (const entry of Array.isArray(events) ? events : []) {
      const event = entry?.event || entry || {};
      const data = event.data || {};
      if (event.type === 'request/header' || event.type === 'request/context') {
        const config = data.config || data;
        currentConfig = { provider: config.provider || data.provider || currentConfig.provider || '', model: config.model || data.model || currentConfig.model || '' };
      }
      if (event.type !== 'assistant/message') continue;
      const usage = data.usage || data.message?.usage;
      if (!usage) continue;
      const source = data.message?.source || data.source || {};
      const config = { ...currentConfig, ...source };
      const promptTokens = readUsage(usage, 'promptTokens') || readUsage(usage, 'inputTokens');
      const completionTokens = readUsage(usage, 'completionTokens') || readUsage(usage, 'outputTokens');
      const totalTokens = readUsage(usage, 'totalTokens') || promptTokens + completionTokens;
      const cacheHitTokens = readUsage(usage, 'cacheReadTokens') || readUsage(usage, 'cachedTokens') || readUsage(usage, 'cacheHitTokens');
      const reasoningTokens = readUsage(usage, 'reasoningTokens') || readUsage(usage, 'thinkingTokens');
      out.push(await this.recordUsage({ eventSeq: event.seq, provider: config.provider || 'deepseek-official', model: config.model || 'unknown', sessionId, workspace, promptTokens, completionTokens, totalTokens, cacheHitTokens, cacheMissTokens: Math.max(0, promptTokens - cacheHitTokens), reasoningTokens, requestAt: event.time, source: 'session-event' }));
    }
    return out;
  }

  summarize({ sessionId = '', now = new Date() } = {}) {
    this.load();
    const records = this.state.usage.records;
    const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
    const startWeek = new Date(startToday); startWeek.setDate(startWeek.getDate() - 6);
    const startMonth = new Date(startToday.getFullYear(), startToday.getMonth(), 1);
    const aggregate = (items) => {
      const sum = (key) => items.reduce((total, item) => total + asNumber(item[key]), 0);
      const cost = items.reduce((total, item) => total + asNumber(item.estimatedCost), 0);
      return { promptTokens: sum('promptTokens'), completionTokens: sum('completionTokens'), totalTokens: sum('totalTokens'), reasoningTokens: sum('reasoningTokens'), cacheHitTokens: sum('cacheHitTokens'), cacheMissTokens: sum('cacheMissTokens'), requests: items.length, estimatedCost: Number(cost.toFixed(8)), currency: pricing.currency };
    };
    const inRange = (from) => records.filter((item) => (Date.parse(item.requestAt) || 0) >= from.getTime());
    const sessionRecords = sessionId ? records.filter((item) => item.sessionId === sessionId) : [];
    return { schemaVersion: SCHEMA_VERSION, pricing: clone(pricing), today: aggregate(inRange(startToday)), last7Days: aggregate(inRange(startWeek)), month: aggregate(inRange(startMonth)), session: aggregate(sessionRecords), records: records.slice(-200).reverse(), balance: { status: 'official-unavailable', message: '官方公开 API 未提供可靠余额接口；请打开 DeepSeek Billing 页面查看真实余额。', currency: null, amount: null, updatedAt: null } };
  }

  async clearUsage() { this.load(); this.state.usage.records = []; await this.persist(); return { ok: true }; }
  async clearAll() { this.load(); this.state = emptyState(); await this.persist(); return { ok: true }; }
  exportData() { return clone(this.load()); }
  describePaths() {
    return { dataDir: this.root, usageFile: this.file, backupFile: this.backup };
  }
}

module.exports = { AppDataService, SCHEMA_VERSION, normalizeUsageRecord, usageCost, pricing, readUsage };
