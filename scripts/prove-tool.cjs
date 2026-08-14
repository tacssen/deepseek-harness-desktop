// Offline proof: a local mock DeepSeek endpoint captures the outgoing tool
// catalog. No provider credential is used and no image/key leaves the machine.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const home = path.join(root, '.proof-home');
const cli = path.join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
const standard = path.join(root, 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets', 'standard');
const toolName = '@deepseek-harness/vision-plugin';

function writeFixture() {
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'settings.yaml'), [
    'llm-deepseek:', '  baseURL: http://127.0.0.1:19193',
    'agent-default-model:', '  provider: deepseek-official', '  model: deepseek-v4-flash',
    'agent-presets:', '  default: deepseek-desktop', '',
  ].join('\n'));
  fs.writeFileSync(path.join(home, 'cordis.patch.yml'), '[]\n');
  const modules = path.join(home, 'node_modules');
  try { fs.symlinkSync(path.join(root, 'node_modules'), modules, 'junction'); } catch {}
  const preset = path.join(home, '.agent-presets', 'deepseek-desktop');
  fs.mkdirSync(path.dirname(preset), { recursive: true });
  fs.cpSync(standard, preset, { recursive: true });
  fs.appendFileSync(path.join(preset, 'agent.cordis.yml'), `\n- id: vision-analyze\n  name: '${toolName}'\n`);
}

function startMock() {
  const catalogs = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      if (request.url === '/models') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ data: [{ id: 'deepseek-v4-flash' }] }));
        return;
      }
      if (request.url === '/chat/completions') {
        try { catalogs.push(JSON.parse(body).tools || []); } catch { catalogs.push([]); }
        response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' });
        response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`);
        response.end('data: [DONE]\n\n');
        return;
      }
      response.writeHead(404); response.end();
    });
  });
  return { server, catalogs };
}

async function rpc(port, method, payload) {
  const response = await fetch(`http://127.0.0.1:${port}/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: `${method}-${Date.now()}`, method, payload }) });
  const text = await response.text();
  try { return JSON.parse(text); } catch { throw new Error(`RPC ${method} HTTP ${response.status}: ${text.slice(0, 300)}`); }
}

async function main() {
  writeFixture();
  const mock = startMock();
  await new Promise((resolve) => mock.server.listen(19193, '127.0.0.1', resolve));
  const child = spawn(process.execPath, [cli, 'web', '--host', '127.0.0.1', '--port', '19194'], { cwd: root, env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: 'offline-proof-key' }, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  try {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      try { const response = await fetch('http://127.0.0.1:19194/'); if (response.status === 200) break; } catch {}
      if (child.exitCode !== null) throw new Error(`dsh exited ${child.exitCode}`);
    }
    let created;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try { created = await rpc(19194, 'session.create', { cwd: root }); if (created.result) break; } catch (error) { if (attempt === 119) throw error; }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!created.result?.value?.sessionId) throw new Error('session.create failed');
    const sessionId = created.result.value.sessionId;
    const models = await rpc(19194, 'session.models', { sessionId });
    if (models.result?.value?.routable !== true) throw new Error('DeepSeek route is not routable');
    await rpc(19194, 'session.prompt', { sessionId, mode: 'queue', content: [{ type: 'text', text: 'Say OK.' }] });
    let completed = false; let lastTypes = [];
    for (let attempt = 0; attempt < 100; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const history = await rpc(19194, 'session.history', { sessionId, maxMessages: 30 });
      const entries = history.result?.value?.events || history.result?.value?.entries || [];
      lastTypes = entries.map((entry) => `${entry.event?.type}:${entry.event?.data?.reason?.kind || ''}`);
      if (entries.some((entry) => entry.event?.type === 'turn/end' && entry.event.data?.reason?.kind === 'completed')) { completed = true; break; }
    }
    const visible = mock.catalogs.some((catalog) => catalog.some((tool) => (tool.function?.name || tool.name) === 'vision_analyze'));
    console.log(JSON.stringify({ routable: models.result.value.routable, toolVisible: visible, turnCompleted: completed, chatRequests: mock.catalogs.length, eventTypes: lastTypes }));
    if (!visible || !completed) throw new Error('tool catalog or completed turn proof failed');
  } catch (error) {
    console.error(`proof failed: ${error.message}`);
    if (stderr) console.error(stderr.slice(-2000));
    process.exitCode = 1;
  } finally {
    child.kill(); mock.server.close();
  }
}

main();
