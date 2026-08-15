const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Codex → DeepSeek → Codex acceptance used one real worktree', () => {
  const file = path.join(__dirname, 'fixtures', 'agent-handoff-continuity.txt');
  const phases = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  assert.deepEqual(phases, ['phase-a=codex', 'phase-b=deepseek', 'phase-c=codex']);
});
