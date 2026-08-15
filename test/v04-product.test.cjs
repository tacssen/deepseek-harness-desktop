const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { AGENT_LEVELS, listAgentLevels } = require('../src/agent-levels.cjs');
const { AppDataService } = require('../src/app-data-service.cjs');
const { SecureStore, validateProfile } = require('../src/secure-store.cjs');

test('Agent Levels map to distinct provider effort and execution budgets', () => {
  const levels = listAgentLevels();
  assert.deepEqual(levels.map((item) => item.id), ['low', 'medium', 'high', 'extra-high', 'max']);
  assert.equal(AGENT_LEVELS.low.reasoningEffort, 'high');
  assert.equal(AGENT_LEVELS.medium.maxSteps < AGENT_LEVELS.high.maxSteps, true);
  assert.equal(AGENT_LEVELS.high.reasoningEffort, 'high');
  assert.equal(AGENT_LEVELS['extra-high'].reasoningEffort, 'max');
  assert.equal(AGENT_LEVELS.max.maxSteps > AGENT_LEVELS['extra-high'].maxSteps, true);
  assert.equal(new Set(levels.map((item) => `${item.reasoningEffort}:${item.maxParallelToolCalls}:${item.maxSteps}:${item.verify}:${item.repair}`)).size, 5);
});

test('Usage service records response usage, estimates cost, deduplicates and exposes honest balance', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-v04-usage-'));
  const service = new AppDataService({ getPath: () => root }, { warn() {}, info() {} });
  service.load();
  await service.recordSessionEvents([
    { event: { seq: 1, type: 'request/context', data: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } } },
    { event: { seq: 2, type: 'assistant/message', time: new Date().toISOString(), data: { usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500, reasoning_tokens: 120, prompt_cache_hit_tokens: 200 } } } },
  ], { sessionId: 's1', workspace: root });
  await service.recordSessionEvents([
    { event: { seq: 1, type: 'request/context', data: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } } },
    { event: { seq: 2, type: 'assistant/message', time: new Date().toISOString(), data: { usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 } } } },
  ], { sessionId: 's1', workspace: root });
  const summary = service.summarize({ sessionId: 's1' });
  assert.equal(summary.session.requests, 1);
  assert.equal(summary.session.totalTokens, 1500);
  assert.equal(summary.session.reasoningTokens, 120);
  assert.equal(summary.balance.status, 'official-unavailable');
  assert.equal(typeof summary.session.estimatedCost, 'number');
  assert.ok(service.describePaths().usageFile.endsWith('app-state.json'));
  await fs.rm(root, { recursive: true, force: true });
});

test('profile validation accepts portable preferences and rejects secret-shaped fields', () => {
  const value = validateProfile({ schemaVersion: 1, kind: 'deepseek-harness-desktop-profile', preferences: { agent: { level: 'max' }, workspace: { path: '' } } });
  assert.equal(value.preferences.agent.level, 'max');
  assert.throws(() => validateProfile({ schemaVersion: 1, kind: 'deepseek-harness-desktop-profile', preferences: { deepseekApiKey: 'secret' } }), /forbidden secret/i);
});

test('permission presets are enforced and Computer remains deferred', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-v04-perm-'));
  const fakeApp = { getPath: () => root };
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() };
  const store = new SecureStore(fakeApp, safeStorage); store.load();
  const value = await store.save({ permissions: { preset: 'read-only', workspaceWrite: true, terminal: true, browser: true, computer: true } });
  assert.equal(value.permissions.workspaceWrite, false); assert.equal(value.permissions.terminal, false); assert.equal(value.permissions.browser, false); assert.equal(value.permissions.computer, false);
  await fs.rm(root, { recursive: true, force: true });
});
