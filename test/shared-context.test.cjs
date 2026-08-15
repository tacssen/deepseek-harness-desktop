const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { SharedContextService, isWithin } = require('../src/shared-context-service.cjs');

async function fixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-shared-'));
  const project = path.join(base, 'project'); const codex = path.join(base, '.codex');
  await fs.mkdir(project); await fs.mkdir(path.join(codex, 'sessions', '2026', '08', '15'), { recursive: true });
  const codexClient = { listThreads: async (cwd) => cwd === project ? [{ id: 'task-1', cwd, title: 'Task' }] : [], readThread: async () => ({ thread: { turns: [] } }), close: async () => {} };
  const service = new SharedContextService({ codexHome: codex, codexClient, clock: () => new Date('2026-08-15T10:00:00.000Z') });
  return { base, project, codex, service };
}

test('initializes a standard project-local shared layer without replacing AGENTS.md', async (t) => {
  const x = await fixture(); t.after(() => fs.rm(x.base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  await fs.writeFile(path.join(x.project, 'AGENTS.md'), 'keep-me\n');
  const result = await x.service.initialize(x.project);
  assert.equal(await fs.readFile(path.join(x.project, 'AGENTS.md'), 'utf8'), 'keep-me\n');
  assert.equal(result.project.shared, true);
  assert.match(await fs.readFile(path.join(x.project, '.agents', 'README.md'), 'utf8'), /not a copy/i);
});

test('lock excludes another live agent and releases only for its owner', async (t) => {
  const x = await fixture(); t.after(() => fs.rm(x.base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })); await x.service.initialize(x.project);
  await x.service.acquireLock(x.project, { agent: 'deepseek' });
  await assert.rejects(() => x.service.acquireLock(x.project, { agent: 'codex' }), { code: 'PROJECT_LOCKED' });
  assert.equal((await x.service.releaseLock(x.project)).released, true);
  assert.equal(await x.service.readLock(x.project), null);
});

test('writes a redacted structured handoff and machine-readable state', async (t) => {
  const x = await fixture(); t.after(() => fs.rm(x.base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })); await x.service.initialize(x.project);
  const result = await x.service.prepareHandoff(x.project, { fromAgent: 'deepseek', goal: 'ship', completed: ['phase B'], pending: ['phase C'], summary: 'Authorization: Bearer short-test', nextAction: 'continue' });
  const markdown = await fs.readFile(path.join(x.project, '.agents', 'HANDOFF.md'), 'utf8');
  assert.match(markdown, /phase B/); assert.doesNotMatch(markdown, /short-test/); assert.match(markdown, /\[REDACTED\]/);
  assert.equal(result.state.lastHandoff.toAgent, 'codex');
});

test('Codex adapter uses the injected official read-only client with exact cwd', async (t) => {
  const x = await fixture(); t.after(() => fs.rm(x.base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const result = await x.service.findCodexSessions(x.project);
  assert.equal(result.sessions.length, 1); assert.equal(result.mode, 'official-app-server-read-only');
});

test('path boundary helper rejects siblings', () => {
  assert.equal(isWithin('C:\\work\\a', 'C:\\work\\a\\x'), true);
  assert.equal(isWithin('C:\\work\\a', 'C:\\work\\ab\\x'), false);
});
