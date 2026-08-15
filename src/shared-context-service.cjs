const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { redact } = require('./logger.cjs');
const { CodexAppServerClient } = require('./codex-app-server-client.cjs');

const execFileAsync = promisify(execFile);
const SCHEMA_VERSION = 1;
const AGENT_DIR = '.agents';
const RUNTIME_IGNORE = `# Private, machine-local Agent relay state\n/locks/\n/sessions/\n/checkpoints/\n/project-state.json\n/HANDOFF.md\n/TASKS.md\n/MEMORY.md\n/TESTS.md\n/codex-session-index.json\n`;

function safeText(value, max = 20_000) {
  return redact(String(value ?? '')).replace(/\0/g, '').slice(0, max);
}

function normalizeRoot(root) {
  if (!root || typeof root !== 'string') throw new Error('项目路径不能为空');
  return path.resolve(root);
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function atomicWrite(file, content) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(temp, content, { encoding: 'utf8', mode: 0o600 });
  await fsp.rename(temp, file);
}

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function exists(file) {
  try { await fsp.access(file); return true; } catch { return false; }
}

function projectId(root) {
  return crypto.createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex').slice(0, 20);
}

function mdList(values, empty = '无') {
  const items = (Array.isArray(values) ? values : []).map((item) => safeText(typeof item === 'string' ? item : item?.content || item?.message || JSON.stringify(item), 1000)).filter(Boolean);
  return items.length ? items.map((item) => `- ${item}`).join('\n') : `- ${empty}`;
}

class SharedContextService {
  constructor({ logger, codexHome = path.join(os.homedir(), '.codex'), clock = () => new Date(), codexClient } = {}) {
    this.logger = logger || { info() {}, warn() {} };
    this.codexHome = codexHome;
    this.clock = clock;
    this.lockTokens = new Map();
    this.codexClient = codexClient || new CodexAppServerClient({ logger: this.logger });
  }

  files(root) {
    const projectRoot = normalizeRoot(root);
    const dir = path.join(projectRoot, AGENT_DIR);
    return {
      root: projectRoot, dir,
      state: path.join(dir, 'project-state.json'), tasks: path.join(dir, 'TASKS.md'),
      handoff: path.join(dir, 'HANDOFF.md'), memory: path.join(dir, 'MEMORY.md'),
      decisions: path.join(dir, 'DECISIONS.md'), tests: path.join(dir, 'TESTS.md'),
      readme: path.join(dir, 'README.md'), ignore: path.join(dir, '.gitignore'),
      lock: path.join(dir, 'locks', 'project-lock.json'), sessions: path.join(dir, 'sessions'),
      rootAgents: path.join(projectRoot, 'AGENTS.md'),
    };
  }

  async detect(root) {
    const files = this.files(root);
    const [git, agents, shared, handoff, tasks] = await Promise.all([
      exists(path.join(files.root, '.git')), exists(files.rootAgents), exists(files.dir), exists(files.handoff), exists(files.tasks),
    ]);
    const state = await readJson(files.state, null).catch(() => null);
    const lock = await this.readLock(files.root);
    return { projectId: state?.projectId || projectId(files.root), root: files.root, name: path.basename(files.root), git, agents, shared, handoff, tasks, state, lock };
  }

  async initialize(root, { createAgents = true } = {}) {
    const files = this.files(root);
    const now = this.clock().toISOString();
    await fsp.mkdir(files.sessions, { recursive: true });
    await fsp.mkdir(path.dirname(files.lock), { recursive: true });
    if (!(await exists(files.ignore))) await atomicWrite(files.ignore, RUNTIME_IGNORE);
    if (!(await exists(files.readme))) await atomicWrite(files.readme, this.readmeTemplate());
    if (!(await exists(files.tasks))) await atomicWrite(files.tasks, '# Shared Tasks\n\n## In progress\n\n- [ ] Describe the next concrete task.\n\n## Done\n\n');
    if (!(await exists(files.handoff))) await atomicWrite(files.handoff, '# Agent Handoff\n\nNo handoff has been prepared yet.\n');
    if (!(await exists(files.memory))) await atomicWrite(files.memory, '# Project Memory\n\nDurable project facts only. Do not place secrets or raw chat transcripts here.\n');
    if (!(await exists(files.decisions))) await atomicWrite(files.decisions, '# Decisions\n\nRecord durable technical decisions and rationale here.\n');
    if (!(await exists(files.tests))) await atomicWrite(files.tests, '# Test State\n\nNo shared test result has been recorded yet.\n');
    const current = await readJson(files.state, null);
    if (!current) await atomicWrite(files.state, `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, projectId: projectId(files.root), revision: 0, projectRootHint: '.', goal: '', currentAgent: null, lastHandoff: null, updatedAt: now }, null, 2)}\n`);
    if (createAgents && !(await exists(files.rootAgents))) await atomicWrite(files.rootAgents, this.agentsTemplate());
    return this.read(files.root);
  }

  readmeTemplate() {
    return `# Shared Agent Context\n\nThis directory is a project-local interoperability layer for coding agents. It is not a copy of the project and does not synchronize private chat databases.\n\n- \`HANDOFF.md\`: concise continuation context\n- \`TASKS.md\`: shared task state\n- \`MEMORY.md\`: durable, non-secret project facts\n- \`DECISIONS.md\`: technical decisions and rationale\n- \`TESTS.md\`: latest test evidence\n- \`project-state.json\`: versioned machine-readable summary\n- \`locks/\`: machine-local advisory locks (Git-ignored)\n- \`sessions/\`: private local summaries (Git-ignored)\n\nNever store API keys, cookies, tokens, full chat transcripts, or machine credentials here.\n`;
  }

  agentsTemplate() {
    return `# Shared Agent Project Instructions\n\nBefore changing this project, read \`.agents/HANDOFF.md\`, \`.agents/TASKS.md\`, \`.agents/DECISIONS.md\`, and \`.agents/TESTS.md\` when present. Work in this exact directory; never create a second project copy for handoff. Respect \`.agents/locks/project-lock.json\` when it names another active agent. Preserve unrelated user changes and existing project-specific instructions. Before yielding, update the shared task/test state and prepare a concise handoff without secrets or raw chat transcripts.\n`;
  }

  async read(root) {
    const files = this.files(root);
    const read = async (file, max = 80_000) => { try { return safeText(await fsp.readFile(file, 'utf8'), max); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; } };
    const [state, tasks, handoff, memory, decisions, tests, lock, git, codex] = await Promise.all([
      readJson(files.state, null).catch(() => null), read(files.tasks), read(files.handoff), read(files.memory), read(files.decisions), read(files.tests), this.readLock(files.root), this.gitState(files.root), this.findCodexSessions(files.root),
    ]);
    return { project: await this.detect(files.root), state, tasks, handoff, memory, decisions, tests, lock, git, codex };
  }

  async acquireLock(root, { agent, sessionId = null, ttlMs = 120_000, forceStale = true } = {}) {
    if (!['codex', 'deepseek'].includes(agent)) throw new Error('未知 Agent');
    const files = this.files(root);
    await fsp.mkdir(path.dirname(files.lock), { recursive: true });
    const existing = await this.readLock(files.root);
    const now = this.clock();
    if (existing?.active && existing.agent !== agent) throw Object.assign(new Error(`${existing.agent} 正在使用此项目`), { code: 'PROJECT_LOCKED', lock: existing });
    if (existing && !existing.active && !forceStale) throw Object.assign(new Error('项目存在过期锁'), { code: 'PROJECT_LOCK_STALE', lock: existing });
    const token = crypto.randomBytes(24).toString('hex');
    const lock = { schemaVersion: SCHEMA_VERSION, projectId: projectId(files.root), agent, pid: process.pid, sessionId, tokenHash: crypto.createHash('sha256').update(token).digest('hex'), acquiredAt: now.toISOString(), heartbeatAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttlMs).toISOString() };
    await atomicWrite(files.lock, `${JSON.stringify(lock, null, 2)}\n`);
    this.lockTokens.set(files.root, token);
    return { ...lock, tokenHash: undefined, active: true };
  }

  async heartbeat(root, ttlMs = 120_000) {
    const files = this.files(root);
    const token = this.lockTokens.get(files.root);
    const current = await readJson(files.lock, null);
    if (!token || !current || crypto.createHash('sha256').update(token).digest('hex') !== current.tokenHash) throw new Error('当前进程不持有项目锁');
    const now = this.clock();
    current.heartbeatAt = now.toISOString(); current.expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    await atomicWrite(files.lock, `${JSON.stringify(current, null, 2)}\n`);
    return { ...current, tokenHash: undefined, active: true };
  }

  async releaseLock(root) {
    const files = this.files(root);
    const token = this.lockTokens.get(files.root);
    const current = await readJson(files.lock, null);
    if (!current) return { released: false };
    if (!token || crypto.createHash('sha256').update(token).digest('hex') !== current.tokenHash) return { released: false, reason: 'not-owner' };
    await fsp.rm(files.lock, { force: true });
    this.lockTokens.delete(files.root);
    return { released: true };
  }

  async readLock(root) {
    const files = this.files(root);
    const value = await readJson(files.lock, null).catch(() => null);
    if (!value) return null;
    const active = Number.isFinite(Date.parse(value.expiresAt)) && Date.parse(value.expiresAt) > this.clock().getTime();
    const { tokenHash: _secret, ...publicValue } = value;
    return { ...publicValue, active, stale: !active };
  }

  async prepareHandoff(root, input = {}) {
    const files = this.files(root);
    await this.initialize(files.root, { createAgents: true });
    const now = this.clock().toISOString();
    const previous = await readJson(files.state, {});
    const fromAgent = input.fromAgent === 'codex' ? 'codex' : 'deepseek';
    const toAgent = fromAgent === 'codex' ? 'deepseek' : 'codex';
    const goal = safeText(input.goal || previous.goal || '', 4000);
    const completed = (input.completed || []).slice(0, 50);
    const pending = (input.pending || []).slice(0, 50);
    const problems = (input.problems || []).slice(0, 30);
    const changedFiles = (input.changedFiles || []).slice(0, 200);
    const tests = (input.tests || []).slice(0, 60);
    const decisions = (input.decisions || []).slice(0, 60);
    const nextAction = safeText(input.nextAction || pending[0] || '', 2000);
    const summary = safeText(input.summary || '', 12_000);
    const id = `handoff-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const handoff = { id, fromAgent, toAgent, createdAt: now, goal, summary, completed, pending, changedFiles, tests, problems, decisions, nextAction, git: await this.gitState(files.root) };
    const markdown = this.renderHandoff(handoff);
    await atomicWrite(files.handoff, markdown);
    await atomicWrite(files.tasks, this.renderTasks(pending, completed, now));
    await atomicWrite(files.tests, this.renderTests(tests, problems, now));
    if (decisions.length) await atomicWrite(files.decisions, `# Decisions\n\nUpdated: ${now}\n\n${mdList(decisions)}\n`);
    const state = { schemaVersion: SCHEMA_VERSION, projectId: projectId(files.root), revision: Number(previous.revision || 0) + 1, projectRootHint: '.', goal, currentAgent: null, lastHandoff: { id, fromAgent, toAgent, createdAt: now }, nextAction, updatedAt: now };
    await atomicWrite(files.state, `${JSON.stringify(state, null, 2)}\n`);
    const sessionFile = path.join(files.sessions, `${now.replace(/[:.]/g, '-')}-${fromAgent}.json`);
    await atomicWrite(sessionFile, `${JSON.stringify(handoff, null, 2)}\n`);
    await this.releaseLock(files.root);
    return { id, handoff: markdown, state };
  }

  renderHandoff(value) {
    return `# Agent Handoff\n\n- From: **${value.fromAgent}**\n- To: **${value.toAgent}**\n- Time: ${value.createdAt}\n- Goal: ${value.goal || '未记录'}\n\n## Important Summary\n\n${value.summary || '无'}\n\n## Completed\n\n${mdList(value.completed)}\n\n## Pending\n\n${mdList(value.pending)}\n\n## Changed Files\n\n${mdList(value.changedFiles)}\n\n## Tests\n\n${mdList(value.tests)}\n\n## Problems\n\n${mdList(value.problems)}\n\n## Decisions\n\n${mdList(value.decisions)}\n\n## Next Suggested Action\n\n${value.nextAction || 'Review the current worktree and choose the next task.'}\n\n## Git Snapshot\n\n- Branch: ${safeText(value.git.branch || 'n/a', 200)}\n- HEAD: ${safeText(value.git.head || 'n/a', 200)}\n- Dirty: ${value.git.dirty ? 'yes' : 'no'}\n\n> This is a structured handoff, not a synchronized private chat transcript.\n`;
  }

  renderTasks(pending, completed, now) { return `# Shared Tasks\n\nUpdated: ${now}\n\n## In progress\n\n${(pending.length ? pending : ['Review handoff and select the next task.']).map((item) => `- [ ] ${safeText(item, 1000)}`).join('\n')}\n\n## Done\n\n${completed.length ? completed.map((item) => `- [x] ${safeText(item, 1000)}`).join('\n') : '- None recorded'}\n`; }
  renderTests(tests, problems, now) { return `# Test State\n\nUpdated: ${now}\n\n## Results\n\n${mdList(tests, 'No test result recorded')}\n\n## Failures / blockers\n\n${mdList(problems)}\n`; }

  async gitState(root) {
    const options = { windowsHide: true, timeout: 8000, maxBuffer: 512 * 1024 };
    try {
      const [{ stdout: branch }, { stdout: head }, { stdout: status }] = await Promise.all([
        execFileAsync('git.exe', ['-C', root, 'branch', '--show-current'], options), execFileAsync('git.exe', ['-C', root, 'rev-parse', 'HEAD'], options), execFileAsync('git.exe', ['-C', root, 'status', '--porcelain=v1', '--untracked-files=all'], options),
      ]);
      const files = status.split(/\r?\n/).filter(Boolean).slice(0, 500).map((line) => ({ status: line.slice(0, 2), path: safeText(line.slice(3), 1000) }));
      return { repository: true, branch: branch.trim(), head: head.trim(), dirty: files.length > 0, files };
    } catch { return { repository: false, branch: '', head: '', dirty: false, files: [] }; }
  }

  async findCodexSessions(root) {
    try {
      const sessions = await this.codexClient.listThreads(normalizeRoot(root), 20);
      return { available: true, mode: 'official-app-server-read-only', warning: '通过 Codex App Server 只读列出精确 CWD 的任务；这不是完整聊天同步。', sessions };
    } catch (error) {
      this.logger.warn(`Codex app-server unavailable: ${error.code || error.message}`);
      return { available: false, mode: 'handoff-only', warning: 'Codex App Server 当前不可用，仍可使用项目 Handoff。', sessions: [] };
    }
  }

  async readCodexContinuation(root, threadId) {
    const allowed = await this.codexClient.listThreads(normalizeRoot(root), 50);
    if (!allowed.some((item) => item.id === threadId)) throw new Error('该 Codex task 不属于当前精确项目目录');
    const result = await this.codexClient.readThread(threadId, { includeTurns: true });
    const thread = result?.thread || result;
    const messages = [];
    for (const turn of (Array.isArray(thread?.turns) ? thread.turns : []).slice(-12)) {
      for (const item of (Array.isArray(turn?.items) ? turn.items : [])) {
        if (!['userMessage', 'agentMessage'].includes(item?.type)) continue;
        const text = extractMessageText(item);
        if (text) messages.push({ role: item.type === 'userMessage' ? 'user' : 'assistant', text: safeText(text, 3000) });
      }
    }
    return { id: threadId, title: safeText(thread?.name || thread?.preview || 'Codex task', 300), updatedAt: Number.isFinite(thread?.updatedAt) ? new Date(thread.updatedAt * 1000).toISOString() : null, messages: messages.slice(-16), notice: '仅从官方 Codex App Server 读取并裁剪必要对话；未复制或修改 Codex 私有数据库。' };
  }

  async close() { await this.codexClient.close().catch(() => {}); }
}

function extractMessageText(item) {
  if (typeof item.text === 'string') return item.text;
  if (typeof item.content === 'string') return item.content;
  if (!Array.isArray(item.content)) return '';
  return item.content.map((part) => typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('\n');
}

module.exports = { SharedContextService, atomicWrite, isWithin, projectId, SCHEMA_VERSION };
