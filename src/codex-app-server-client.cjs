const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { redact } = require('./logger.cjs');

const READ_ONLY_METHODS = new Set(['thread/list', 'thread/read']);

class CodexAppServerClient {
  constructor({ command, logger, timeoutMs = 12_000, spawnImpl = spawn } = {}) {
    this.command = command || (process.platform === 'win32' ? path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'), 'npm', 'codex.cmd') : 'codex');
    this.logger = logger || { warn() {} };
    this.timeoutMs = timeoutMs;
    this.spawnImpl = spawnImpl;
    this.child = null;
    this.pending = new Map();
    this.nextId = 1;
  }

  async start() {
    if (this.child) return;
    const isCmdShim = process.platform === 'win32' && /\.cmd$/i.test(this.command);
    const executable = isCmdShim ? (process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe') : this.command;
    const args = isCmdShim ? ['/d', '/s', '/c', this.command, 'app-server', '--listen', 'stdio://'] : ['app-server', '--listen', 'stdio://'];
    const child = this.spawnImpl(executable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    this.child = child;
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on('line', (line) => this.onLine(line));
    child.stderr.on('data', (chunk) => {
      const message = redact(String(chunk)).trim();
      if (message) this.logger.warn(`Codex app-server: ${message.slice(0, 500)}`);
    });
    child.once('exit', (code) => {
      const error = new Error(`Codex app-server exited (${code ?? 'unknown'})`);
      for (const item of this.pending.values()) item.reject(error);
      this.pending.clear(); this.child = null;
    });
    await this.rawRequest('initialize', { clientInfo: { name: 'harness-workbench', title: 'Harness Workbench', version: '0.3.0' }, capabilities: null });
    this.write({ method: 'initialized', params: {} });
  }

  onLine(line) {
    let value; try { value = JSON.parse(line); } catch { return; }
    if (value.id === undefined || value.id === null) return;
    const pending = this.pending.get(String(value.id));
    if (!pending) return;
    this.pending.delete(String(value.id)); clearTimeout(pending.timer);
    if (value.error) pending.reject(new Error(value.error.message || 'Codex app-server request failed'));
    else pending.resolve(value.result);
  }

  write(value) {
    if (!this.child?.stdin?.writable) throw new Error('Codex app-server 不可用');
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  rawRequest(method, params) {
    return new Promise((resolve, reject) => {
      const id = String(this.nextId++);
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex ${method} timeout`)); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ method, id, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  async request(method, params) {
    if (!READ_ONLY_METHODS.has(method)) throw new Error(`拒绝非只读 Codex 方法：${method}`);
    await this.start();
    return this.rawRequest(method, params);
  }

  async listThreads(cwd, limit = 20) {
    const result = await this.request('thread/list', { cwd, limit, sortKey: 'updated_at', sortDirection: 'desc', useStateDbOnly: true });
    return Array.isArray(result?.data) ? result.data.map(compactThread) : [];
  }

  async readThread(threadId, { includeTurns = false } = {}) {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(String(threadId || ''))) throw new Error('Codex task id 无效');
    return this.request('thread/read', { threadId, includeTurns: Boolean(includeTurns) });
  }

  async close() {
    const child = this.child; this.child = null;
    if (!child) return;
    try { child.stdin.end(); } catch {}
    await new Promise((resolve) => { const timer = setTimeout(() => { try { child.kill(); } catch {} resolve(); }, 1000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
  }
}

function compactThread(thread) {
  return {
    id: String(thread.id || ''), title: redact(String(thread.name || thread.preview || 'Codex task')).slice(0, 300),
    cwd: thread.cwd, createdAt: unixTime(thread.createdAt), updatedAt: unixTime(thread.updatedAt),
    source: thread.source, status: thread.status, git: thread.gitInfo || null, pinned: Boolean(thread.isPinned),
  };
}

function unixTime(value) { return Number.isFinite(value) ? new Date(value * 1000).toISOString() : null; }

module.exports = { CodexAppServerClient, READ_ONLY_METHODS, compactThread };
