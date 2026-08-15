const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { WorkbenchService, within, rpcEnvelope, collectDiffs, summarizeTimeline } = require('../src/workbench-service.cjs');

test('workspace path guard rejects traversal and accepts descendants', () => {
  const root = path.resolve('C:\\workspace');
  assert.equal(within(root, 'src\\index.js').relative, path.join('src', 'index.js'));
  assert.throws(() => within(root, '..\\secret.txt'), /Workspace/);
  assert.throws(() => within(root, 'D:\\outside.txt'), /Workspace/);
});

test('Harness RPC envelope keeps official method and payload', () => {
  assert.deepEqual(rpcEnvelope('session.history', { sessionId: 's1' }, 'r1'), { type: 'client-request', rpcId: 'r1', method: 'session.history', payload: { sessionId: 's1' } });
});

test('diff and timeline parsers extract official event views without raw secrets', () => {
  const events = [
    { event: { type: 'tool/call', seq: 1, data: { name: 'write', arguments: { path: 'a.txt' } } }, view: { view: { diffs: [{ path: 'a.txt', oldText: 'before\n', newText: 'after\n' }] } } },
    { event: { type: 'turn/end', seq: 2, data: { reason: { kind: 'completed' } } } },
  ];
  const diffs = collectDiffs(events);
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].path, 'a.txt');
  const timeline = summarizeTimeline(events);
  assert.match(timeline.map((item) => item.title).join(' '), /调用 write/);
  assert.match(timeline.map((item) => item.title).join(' '), /本轮已完成/);
});

test('diff restore is workspace-bound, backed up and refuses stale content', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-workbench-'));
  const file = path.join(root, 'sample.txt');
  await fs.writeFile(file, 'after', 'utf8');
  const service = new WorkbenchService({ app: { getPath: () => root }, logger: { file: path.join(root, 'none.log'), warn: () => {} }, getPort: () => null, getWorkspace: () => root });
  service.lastDiffs.set('d1', { id: 'd1', path: 'sample.txt', oldText: 'before', newText: 'after' });
  assert.equal((await service.revertDiff({ id: 'd1' })).ok, true);
  assert.equal(await fs.readFile(file, 'utf8'), 'before');
  assert.equal(await fs.readFile(path.join(root, 'workbench', 'backups', 'diff-d1', 'sample.txt'), 'utf8'), 'after');
  await fs.writeFile(file, 'changed-again', 'utf8');
  await assert.rejects(() => service.restoreDiffs([{ path: 'sample.txt', oldText: 'before', newText: 'after' }], 'stale'), /发生变化/);
});
