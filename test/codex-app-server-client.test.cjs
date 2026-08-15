const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { CodexAppServerClient } = require('../src/codex-app-server-client.cjs');

test('app-server client uses only read-only methods and exact cwd filter', async () => {
  let child;
  const spawnImpl = () => {
    child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.stdin.setEncoding('utf8');
    let buffer = ''; child.stdin.on('data', (chunk) => {
      buffer += chunk; const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines.filter(Boolean)) {
        const request = JSON.parse(line);
        if (request.method === 'initialized') continue;
        const result = request.method === 'thread/list' ? { data: [{ id: 'thread-12345678', cwd: 'C:\\repo', preview: 'Task', createdAt: 1, updatedAt: 2 }] } : {};
        child.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`);
      }
    });
    child.kill = () => child.emit('exit', 0); return child;
  };
  const client = new CodexAppServerClient({ spawnImpl, timeoutMs: 1000 });
  const items = await client.listThreads('C:\\repo');
  assert.equal(items.length, 1); assert.equal(items[0].cwd, 'C:\\repo');
  await assert.rejects(() => client.request('thread/delete', {}), /非只读/);
  child.emit('exit', 0);
});
