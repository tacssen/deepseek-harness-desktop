(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const q = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const api = window.workbench || {};
  const empty = (value, fallback = '') => value === undefined || value === null ? fallback : value;
  const asArray = (value) => Array.isArray(value) ? value : [];
  const asObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const text = (value, fallback = '') => String(empty(value, fallback));
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const bool = (value, fallback = false) => value === undefined ? fallback : Boolean(value);
  const esc = (value) => text(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  const defaultState = {
    backend: { ready: false, port: null },
    workspace: {},
    session: { id: '', title: '', running: false, mode: 'chat' },
    goal: null,
    todos: [],
    timeline: [],
    diffs: [],
    stats: { tokenUsage: 0, contextBreakdown: {}, contextPressure: 0, sessionStats: {} },
    skills: [],
    mcpConnections: [],
    checkpoints: [],
    problems: [],
    logs: [],
    gitDiff: '',
    terminalHistory: [],
    shared: { available: false },
  };
  let state = structuredCloneSafe(defaultState);
  let layout = { railOpen: true, dockOpen: false, railWidth: 336, dockHeight: 250 };
  let activeRailTab = 'tasks';
  let activeDockTab = 'terminal';
  let selectedFileIndex = 0;
  let searchTimer;
  let lastFocused;

  function structuredCloneSafe(value) {
    try { return structuredClone(value); } catch { return JSON.parse(JSON.stringify(value)); }
  }

  function normalizeState(raw) {
    const next = asObject(raw);
    const result = structuredCloneSafe(defaultState);
    result.backend = { ...result.backend, ...asObject(next.backend) };
    result.workspace = { ...result.workspace, ...asObject(next.workspace) };
    result.session = { ...result.session, ...asObject(next.session) };
    result.goal = next.goal && typeof next.goal === 'object' ? next.goal : null;
    for (const key of ['todos', 'timeline', 'diffs', 'skills', 'mcpConnections', 'checkpoints', 'problems', 'logs', 'terminalHistory']) result[key] = asArray(next[key]);
    result.stats = { ...result.stats, ...asObject(next.stats) };
    result.stats.contextBreakdown = asObject(result.stats.contextBreakdown);
    result.stats.sessionStats = asObject(result.stats.sessionStats);
    result.gitDiff = text(next.gitDiff);
    result.shared = asObject(next.shared);
    return result;
  }

  function invoke(name, payload) {
    const fn = api[name];
    if (typeof fn !== 'function') return Promise.reject(new Error(`Workbench API unavailable: ${name}`));
    return Promise.resolve(fn(payload));
  }

  function formatCount(value) {
    const n = number(value);
    return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
  }

  function formatTime(value) {
    if (value === undefined || value === null || value === '') return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return text(value).slice(0, 8);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }

  function setText(id, value) { const node = $(id); if (node) node.textContent = text(value); }

  function toast(message, kind = '') {
    if (!message) return;
    const region = $('toastRegion');
    const node = document.createElement('div');
    node.className = `toast ${kind ? `is-${kind}` : ''}`;
    node.textContent = text(message);
    region.append(node);
    window.setTimeout(() => node.remove(), 3600);
  }

  function emptyNode(message) {
    const node = document.createElement('div');
    node.className = 'empty-state';
    node.textContent = text(message);
    return node;
  }

  function render() {
    const shell = $('appShell');
    shell.dataset.railOpen = String(layout.railOpen);
    shell.dataset.dockOpen = String(layout.dockOpen);
    $('railToggle')?.setAttribute('aria-expanded', String(layout.railOpen));
    if (layout.railWidth) shell.style.setProperty('--rail-width', `${Math.max(280, Math.min(440, number(layout.railWidth, 336)))}px`);
    if (layout.dockHeight) shell.style.setProperty('--dock-height', `${Math.max(180, Math.min(420, number(layout.dockHeight, 250)))}px`);

    const ready = bool(state.backend.ready);
    const dot = $('backendDot');
    dot.className = `status-dot ${ready ? '' : 'is-muted'}`;
    setText('backendStatus', ready ? (state.session.running ? '运行中' : '已连接') : '连接中');
    setText('workspaceName', state.workspace.name || state.workspace.title || state.workspace.path?.split(/[\\/]/).pop() || 'DeepSeekHarnessWorkspace');
    setText('fallbackStatus', ready ? `本地后端已 Ready · 127.0.0.1:${empty(state.backend.port, '—')}` : '等待本地后端 Ready…');
    const fallback = $('coreFallback');
    if (fallback) fallback.toggleAttribute('hidden', ready);

    const mode = text(state.session.mode || state.mode || 'chat').toLowerCase();
    q('.mode-button').forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    renderGoal();
    renderShared();
    renderTimeline();
    renderDiffs();
    renderContext();
    renderSkills();
    renderProblems();
    renderLogs();
    renderGitDiff();
    renderTerminalHistory();
    if (activeRailTab) selectRailTab(activeRailTab, false);
    if (activeDockTab) selectDockTab(activeDockTab, false);
  }

  function renderGoal() {
    const projection = asObject(state.goal);
    const goal = projection.goal === null ? {} : (projection.goal && typeof projection.goal === 'object' ? asObject(projection.goal) : projection);
    const hasGoal = Boolean(goal.objective || goal.id || goal.title || goal.description);
    setText('goalTitle', text(goal.title || goal.objective, hasGoal ? '当前 Goal' : '当前任务'));
    const stateNode = $('goalState');
    const status = text(goal.status || (state.session.running ? 'running' : 'idle')).toLowerCase();
    const statusMap = { running: '执行中', active: '执行中', paused: '已暂停', completed: '已完成', complete: '已完成', failed: '失败', idle: '空闲' };
    stateNode.textContent = statusMap[status] || text(goal.status, '空闲');
    stateNode.className = `state-badge ${['running', 'active'].includes(status) ? 'is-running' : ['completed', 'complete'].includes(status) ? 'is-done' : ''}`;
    const summary = $('goalSummary');
    summary.textContent = text(goal.objective || goal.description, hasGoal ? '目标已创建，等待 Agent 更新。' : '从顶部选择 Goal，或者直接在官方 Harness 开始对话。');
    summary.classList.toggle('empty-state', !hasGoal && !state.session.running);
    const todos = asArray(state.todos);
    const doneCount = todos.filter((todo) => bool(todo.done ?? todo.completed ?? todo.checked) || text(todo.status).toLowerCase() === 'completed').length;
    setText('todoCount', todos.length);
    setText('todoProgress', todos.length ? `${doneCount}/${todos.length}` : '—');
    const list = $('todoList');
    list.replaceChildren();
    if (!todos.length) { list.append(emptyNode('尚未收到任务清单')); return; }
    for (const todo of todos) {
      const item = document.createElement('li');
      const todoStatus = text(todo.status).toLowerCase();
      const done = bool(todo.done ?? todo.completed ?? todo.checked) || todoStatus === 'completed';
      item.className = `todo-item ${done ? 'is-done' : ''}`;
      const check = document.createElement('span'); check.className = 'todo-check'; check.textContent = done ? '✓' : '';
      const label = document.createElement('span'); label.className = 'todo-text'; label.textContent = text(todo.title || todo.label || todo.text || todo.description, '未命名任务');
      const percent = document.createElement('span'); percent.className = 'todo-percent';
      if (todo.progress !== undefined) percent.textContent = `${Math.round(number(todo.progress))}%`;
      item.append(check, label, percent); list.append(item);
    }
  }

  function renderShared() {
    const shared = asObject(state.shared);
    const project = asObject(shared.project);
    const machine = asObject(shared.state);
    const lock = asObject(shared.lock);
    const git = asObject(shared.git);
    const codex = asObject(shared.codex);
    setText('sharedProjectName', project.name || state.workspace.name || '当前项目');
    const agent = lock.active ? text(lock.agent) : text(machine.currentAgent);
    const agentNode = $('sharedAgentState');
    agentNode.textContent = agent ? `${agent === 'deepseek' ? 'DeepSeek' : 'Codex'} 工作中` : (project.shared ? '可交接' : '未初始化');
    agentNode.className = `state-badge ${agent ? 'is-running' : ''}`;
    const last = asObject(machine.lastHandoff);
    const handoffText = text(shared.handoff).replace(/^# Agent Handoff\s*/i, '').trim();
    setText('sharedHandoff', handoffText ? handoffText.slice(0, 420) : (project.shared ? '尚未准备 Handoff。' : '打开已有项目后会建立项目内共享层，不复制项目文件。'));
    setText('sharedHandoffTime', last.createdAt ? `${last.fromAgent || 'agent'} → ${last.toAgent || 'agent'} · ${formatTime(last.createdAt)}` : '—');
    setText('sharedGit', git.repository ? `${git.branch || '(detached)'} · ${git.dirty ? `${asArray(git.files).length} changes` : 'clean'}` : '非 Git 项目');
    setText('sharedNext', machine.nextAction || '读取 Handoff 并核对真实工作树');
    setText('codexReadMode', codex.available ? `Codex: 官方 App Server 只读 · 精确项目任务 ${asArray(codex.sessions).length} 个` : 'Codex 私有会话未读取；仍可使用可靠的双向项目 Handoff。');
    const sessions = asArray(codex.sessions);
    const picker = $('codexTaskPicker'); const select = $('codexTaskSelect');
    picker.hidden = sessions.length === 0; select.replaceChildren();
    for (const session of sessions) { const option = document.createElement('option'); option.value = text(session.id); option.textContent = `${text(session.title, 'Codex task').slice(0, 72)} · ${formatTime(session.updatedAt)}`; select.append(option); }
  }


  function renderTimeline() {
    const entries = asArray(state.timeline);
    setText('timelineCount', `${entries.length} 项`);
    const list = $('timelineList'); list.replaceChildren();
    if (!entries.length) { list.append(emptyNode('Agent 运行后，工具调用和思考会出现在这里。')); return; }
    for (const entry of entries.slice(-120).reverse()) {
      const row = document.createElement('div'); row.className = 'timeline-item';
      const button = document.createElement('button'); button.className = 'timeline-summary'; button.type = 'button';
      const type = text(entry.type || entry.kind || entry.event || 'event').toLowerCase();
      const icon = type.includes('error') || type.includes('fail') ? '!' : type.includes('tool') || type.includes('call') ? '⌁' : type.includes('success') || type.includes('done') ? '✓' : '·';
      const time = document.createElement('span'); time.className = 'timeline-time'; time.textContent = formatTime(entry.timestamp || entry.time || entry.createdAt);
      const glyph = document.createElement('span'); glyph.className = `timeline-icon ${icon === '!' ? 'is-error' : icon === '✓' ? 'is-success' : ''}`; glyph.textContent = icon;
      const label = document.createElement('span'); label.className = 'timeline-label'; label.textContent = text(entry.title || entry.label || entry.name || entry.tool || entry.message, type || 'Event');
      button.append(time, glyph, label);
      const detailText = entry.detail ?? entry.details ?? entry.output ?? entry.command ?? entry.error;
      if (detailText !== undefined && detailText !== null && detailText !== '') {
        const detail = document.createElement('pre'); detail.className = 'timeline-detail'; detail.hidden = true; detail.textContent = typeof detailText === 'string' ? detailText : JSON.stringify(detailText, null, 2);
        button.addEventListener('click', () => { detail.hidden = !detail.hidden; button.setAttribute('aria-expanded', String(!detail.hidden)); });
        button.setAttribute('aria-expanded', 'false'); row.append(button, detail);
      } else row.append(button);
      list.append(row);
    }
  }

  function renderDiffs() {
    const diffs = asArray(state.diffs);
    setText('diffCount', diffs.length);
    setText('diffSummary', diffs.length ? `${diffs.length} 个文件` : '干净');
    const list = $('diffList'); list.replaceChildren();
    if (!diffs.length) { list.append(emptyNode('当前没有可审阅的更改。')); return; }
    for (const diff of diffs) {
      const item = document.createElement('div'); item.className = 'diff-item';
      const file = document.createElement('div'); file.className = 'diff-file';
      const kind = document.createElement('span'); kind.className = 'diff-kind'; kind.textContent = text(diff.status || diff.kind || 'M');
      const path = document.createElement('span'); path.textContent = text(diff.path || diff.file || diff.name, '未命名文件'); file.append(kind, path);
      const stat = document.createElement('div'); stat.className = 'diff-stat';
      const adds = number(diff.additions ?? diff.added); const removes = number(diff.deletions ?? diff.removed);
      const add = document.createElement('span'); add.className = 'diff-add'; add.textContent = `+${adds}`;
      const remove = document.createElement('span'); remove.className = 'diff-remove'; remove.textContent = `-${removes}`; stat.append(add, remove);
      const actions = document.createElement('div'); actions.className = 'diff-actions';
      for (const [action, label] of [['accept-diff', '接受'], ['revert-diff', '恢复']]) { const button = document.createElement('button'); button.type = 'button'; button.dataset.action = action; button.dataset.diffId = text(diff.id || diff.path); button.textContent = label; actions.append(button); }
      item.append(file, stat, actions); list.append(item);
    }
  }

  function renderContext() {
    const stats = asObject(state.stats); const breakdown = asObject(stats.contextBreakdown);
    const pressureObject = asObject(stats.contextPressure);
    const pressureRaw = typeof stats.contextPressure === 'object' ? (pressureObject.projectedTokens ?? pressureObject.pressureTokens) : (stats.contextPressure ?? stats.contextPercent);
    const contextWindow = number(pressureObject.contextWindow ?? stats.contextWindow);
    const pressure = Math.max(0, Math.min(100, number(stats.contextPercent ?? (contextWindow ? (number(pressureRaw) / contextWindow) * 100 : pressureRaw))));
    setText('contextPressure', pressure ? `${Math.round(pressure)}%` : '—');
    $('contextMeterFill').style.width = `${pressure}%`;
    const tokenUsage = asObject(stats.tokenUsage);
    const total = number(stats.tokens ?? stats.contextTokens ?? tokenUsage.uncachedInputTokens + tokenUsage.outputTokens + tokenUsage.cacheReadTokens + tokenUsage.cacheWriteTokens);
    setText('contextTotal', total ? `${formatCount(total)} tokens · ${pressure ? Math.round(pressure) + '%' : '未提供容量'}` : '尚无上下文统计');
    const breakdownNode = $('contextBreakdown'); breakdownNode.replaceChildren();
    const entries = Object.entries(breakdown);
    if (!entries.length) breakdownNode.append(emptyNode('官方 Harness 尚未提供分项统计。'));
    for (const [key, value] of entries) { const row = document.createElement('div'); row.className = 'context-row'; const name = document.createElement('span'); name.textContent = key; const amount = document.createElement('strong'); amount.textContent = formatCount(value); row.append(name, amount); breakdownNode.append(row); }
    const session = asObject(stats.sessionStats); const statsNode = $('sessionStats'); statsNode.replaceChildren();
    const statEntries = Object.entries(session);
    if (!statEntries.length) statsNode.append(emptyNode('本轮统计尚未提供。'));
    for (const [key, value] of statEntries.slice(0, 8)) { const cell = document.createElement('div'); cell.className = 'stat-cell'; const name = document.createElement('span'); name.className = 'stat-key'; name.textContent = key; const val = document.createElement('span'); val.className = 'stat-value'; val.textContent = typeof value === 'number' ? formatCount(value) : text(value); cell.append(name, val); statsNode.append(cell); }
  }

  function renderSkills() {
    const skills = asArray(state.skills); setText('skillsCount', skills.length);
    const query = text($('skillSearch').value).trim().toLowerCase();
    const visible = skills.filter((skill) => !query || JSON.stringify(skill).toLowerCase().includes(query));
    const list = $('skillsList'); list.replaceChildren();
    if (!visible.length) { list.append(emptyNode(skills.length ? '没有匹配的 Skill。' : '没有暴露可用能力。')); }
    for (const skill of visible) {
      const item = document.createElement('div'); item.className = 'skill-item'; const name = document.createElement('span'); name.className = 'skill-name'; name.textContent = text(skill.name || skill.id || skill.title, '未命名 Skill'); const meta = document.createElement('span'); meta.className = 'skill-meta'; if (skill.enabled !== undefined) meta.append(Object.assign(document.createElement('span'), { textContent: skill.enabled ? '已启用' : '已停用' })); const button = document.createElement('button'); button.type = 'button'; button.className = 'skill-invoke'; button.dataset.action = 'invoke-skill'; button.dataset.skillName = text(skill.name || skill.id); button.textContent = '调用'; meta.append(button); item.append(name, meta); list.append(item);
    }
    const connections = asArray(state.mcpConnections); setText('mcpCount', `${connections.length} 个连接`); const mcp = $('mcpList'); mcp.replaceChildren(); if (!connections.length) mcp.append(emptyNode('没有 MCP 连接')); for (const connection of connections) { const item = document.createElement('div'); item.className = 'skill-item'; const name = document.createElement('span'); name.className = 'skill-name'; name.textContent = text(connection.name || connection.id, '未命名连接'); const status = document.createElement('span'); status.className = 'skill-meta'; status.textContent = text(connection.status || (connection.connected ? '已连接' : '未连接')); item.append(name, status); mcp.append(item); }
  }

  function renderProblems() {
    const problems = asArray(state.problems); setText('problemCount', problems.length); const list = $('problemList'); list.replaceChildren(); if (!problems.length) { list.append(emptyNode('没有检测到问题。')); return; }
    for (const problem of problems) { const row = document.createElement('div'); row.className = 'problem-row'; const level = document.createElement('span'); level.className = 'problem-level'; level.textContent = text(problem.level || problem.severity || '!', '!'); const message = document.createElement('span'); message.textContent = text(problem.message || problem.title || problem.detail, '未命名问题'); const location = document.createElement('span'); location.className = 'log-time'; location.textContent = text(problem.path || problem.location); row.append(level, message, location); list.append(row); }
  }

  function renderLogs() {
    const logs = asArray(state.logs); const list = $('logList'); list.replaceChildren(); if (!logs.length) { list.append(emptyNode('暂无运行日志。')); return; }
    for (const log of logs.slice(-160).reverse()) { const row = document.createElement('div'); row.className = 'log-row'; const time = document.createElement('span'); time.className = 'log-time'; time.textContent = formatTime(log.timestamp || log.time); const message = document.createElement('span'); message.className = 'log-text'; message.textContent = text(log.message || log.text || log.detail, ''); const level = document.createElement('span'); level.className = 'log-time'; level.textContent = text(log.level || 'info'); row.append(time, message, level); list.append(row); }
  }

  function renderGitDiff() { const node = $('gitDiffOutput'); node.replaceChildren(); if (!state.gitDiff) node.append(emptyNode('暂无 Git Diff。')); else node.textContent = state.gitDiff; }

  function renderTerminalHistory() {
    const history = asArray(state.terminalHistory); const node = $('terminalOutput'); node.replaceChildren(); if (!history.length) { const placeholder = document.createElement('div'); placeholder.className = 'terminal-placeholder'; placeholder.textContent = '命令会交给当前 Agent，通过 Harness 的 PowerShell 工具和权限策略执行。'; node.append(placeholder); return; }
    for (const line of history.slice(-120)) { const row = document.createElement('div'); row.className = 'terminal-line'; const command = text(line.command || line.input); const output = text(line.output || line.stdout || line.stderr); const commandNode = document.createElement('div'); commandNode.className = 'terminal-command'; commandNode.textContent = `PS> ${command}`; row.append(commandNode); if (output) { const outputNode = document.createElement('div'); outputNode.className = line.error ? 'terminal-error' : 'terminal-ok'; outputNode.textContent = output; row.append(outputNode); } node.append(row); }
    node.scrollTop = node.scrollHeight;
  }

  function selectRailTab(tab, focus = true) {
    activeRailTab = tab;
    q('[data-rail-tab]').forEach((button) => { const active = button.dataset.railTab === tab; button.classList.toggle('is-active', active); button.setAttribute('aria-selected', String(active)); });
    q('[data-rail-panel]').forEach((panel) => { const active = panel.dataset.railPanel === tab; panel.classList.toggle('is-active', active); panel.hidden = !active; });
    if (focus) document.querySelector(`[data-rail-tab="${CSS.escape(tab)}"]`)?.focus();
  }
  function selectDockTab(tab, focus = true) {
    activeDockTab = tab;
    q('[data-dock-tab]').forEach((button) => { const active = button.dataset.dockTab === tab; button.classList.toggle('is-active', active); button.setAttribute('aria-selected', String(active)); });
    q('[data-dock-panel]').forEach((panel) => { const active = panel.dataset.dockPanel === tab; panel.classList.toggle('is-active', active); panel.hidden = !active; });
    if (focus) document.querySelector(`[data-dock-tab="${CSS.escape(tab)}"]`)?.focus();
  }
  function persistLayout() { invoke('setLayout', layout).catch(() => {}); }
  function setRail(open) { layout.railOpen = open; render(); persistLayout(); }
  function setDock(open) { layout.dockOpen = open; render(); persistLayout(); }

  function openOverlay(id, focusId) { lastFocused = document.activeElement; const node = $(id); node.hidden = false; window.setTimeout(() => $(focusId)?.focus(), 0); }
  function closeOverlay(id) { const node = $(id); node.hidden = true; if (lastFocused && document.contains(lastFocused)) lastFocused.focus(); }

  async function refresh() {
    try { if (typeof api.getSnapshot === 'function') { state = normalizeState(await api.getSnapshot()); render(); } }
    catch (error) { setText('backendStatus', '状态不可用'); setText('fallbackStatus', text(error.message, '无法读取工作台状态')); }
  }

  function renderFileResults(files) {
    const list = $('fileSearchResults'); list.replaceChildren(); selectedFileIndex = 0;
    if (!files.length) { list.append(emptyNode('没有匹配的文件。')); return; }
    files.forEach((file, index) => { const button = document.createElement('button'); button.type = 'button'; button.className = `file-result ${index === 0 ? 'is-selected' : ''}`; button.dataset.filePath = text(file.path || file); const icon = document.createElement('svg'); icon.setAttribute('viewBox', '0 0 24 24'); icon.innerHTML = '<path d="M5 4.5h9l5 5v10H5zM14 4.5v5h5"></path>'; const path = document.createElement('span'); path.className = 'file-result-path'; path.textContent = text(file.path || file); const kind = document.createElement('span'); kind.className = 'file-result-kind'; kind.textContent = text(file.kind || file.type || 'file'); button.append(icon, path, kind); button.addEventListener('click', () => insertFile(text(file.path || file))); list.append(button); });
  }
  async function searchFiles(query) { if (!text(query).trim()) { renderFileResults([]); $('fileSearchResults').replaceChildren(emptyNode('输入关键词开始搜索。')); return; } try { const result = await invoke('listFiles', { query: text(query).trim() }); const files = asArray(result?.files || result); renderFileResults(files); } catch (error) { $('fileSearchResults').replaceChildren(emptyNode(text(error.message, '搜索失败'))); } }
  async function insertFile(path, analyze = false) { try { await invoke('insertReference', { path, analyze }); closeOverlay('fileSearchOverlay'); toast(`已引用 ${path}`, 'good'); } catch (error) { toast(text(error.message, '插入引用失败'), 'bad'); } }

  function ensureAttachmentTray() {
    let tray = $('attachmentTray'); if (tray) return tray; tray = document.createElement('div'); tray.id = 'attachmentTray'; tray.className = 'attachment-tray'; document.body.append(tray); return tray;
  }
  function showAttachments(files) {
    const tray = ensureAttachmentTray(); tray.replaceChildren(); const title = document.createElement('div'); title.className = 'attachment-title'; title.textContent = `已添加 ${files.length} 个附件`; tray.append(title);
    files.forEach((file) => { const row = document.createElement('div'); row.className = 'attachment-row'; const name = document.createElement('span'); name.className = 'attachment-name'; name.textContent = text(file.name || file.path, '未命名文件'); row.append(name); const path = text(file.path || file); const image = /\.(png|jpe?g|webp|gif)$/i.test(path) || text(file.type).startsWith('image/'); if (image) { const button = document.createElement('button'); button.className = 'attachment-action'; button.type = 'button'; button.textContent = '用 Vision 分析'; button.addEventListener('click', () => insertFile(path, true)); row.append(button); } tray.append(row); });
    window.setTimeout(() => { tray.classList.add('is-visible'); }, 0); window.setTimeout(() => { tray.classList.remove('is-visible'); window.setTimeout(() => tray.remove(), 240); }, 7000);
  }

  async function attach() { try { const result = await invoke('attachFiles'); const files = asArray(result?.files || result); if (files.length) showAttachments(files); else toast('没有选择附件。', 'warn'); } catch (error) { toast(text(error.message, '添加附件失败'), 'bad'); } }
  async function runTerminal(command) { const value = text(command).trim(); if (!value) return; $('terminalInput').value = ''; try { const result = await invoke('runTerminal', { command: value }); const output = text(result?.output ?? result?.stdout ?? result?.stderr ?? result?.error); const history = asArray(state.terminalHistory); history.push({ command: value, output, error: Boolean(result?.error || result?.ok === false) }); state.terminalHistory = history; renderTerminalHistory(); setDock(true); } catch (error) { const history = asArray(state.terminalHistory); history.push({ command: value, output: text(error.message), error: true }); state.terminalHistory = history; renderTerminalHistory(); setDock(true); } }

  async function modeSelected(mode) { if (mode === 'goal') { openOverlay('goalOverlay', 'goalInput'); return; } try { const result = await invoke('setMode', { mode }); if (result?.ok === false) throw new Error(text(result.error, '模式切换不可用')); state.session.mode = mode; render(); } catch (error) { toast(text(error.message, '无法切换模式'), 'bad'); } }

  async function goalSubmitted(event) { event.preventDefault(); const objective = text($('goalInput').value).trim(); if (!objective) { $('goalInput').focus(); return; } try { const result = await invoke('setMode', { mode: 'goal', objective }); if (result?.ok === false) throw new Error(text(result.error, 'Goal 不可用')); $('goalInput').value = ''; closeOverlay('goalOverlay'); state.session.mode = 'goal'; state.goal = { objective, status: 'active' }; render(); toast('Goal 已发送给 Agent。', 'good'); } catch (error) { toast(text(error.message, 'Goal 启动失败'), 'bad'); } }

  async function checkpoint() { try { const result = await invoke('createCheckpoint'); if (result?.ok === false) throw new Error(text(result.error, 'Checkpoint 不可用')); toast(result?.id ? `Checkpoint ${result.id} 已创建` : text(result?.status, 'Checkpoint 已创建'), 'good'); await refresh(); } catch (error) { toast(text(error.message, '创建 checkpoint 失败'), 'bad'); } }
  async function invokeSkill(name) { try { const result = await invoke('invokeSkill', { name }); if (result?.ok === false) throw new Error(text(result.error, 'Skill 不可用')); toast(text(result?.status, `已请求调用 ${name}`), 'good'); } catch (error) { toast(text(error.message, 'Skill 调用失败'), 'bad'); } }
  async function diffAction(action, id) { try { const result = await invoke(action === 'accept-diff' ? 'acceptDiff' : 'revertDiff', { id }); if (result?.ok === false) throw new Error(text(result.error, '此更改为只读观察')); toast(text(result?.status, action === 'accept-diff' ? '更改已接受。' : '更改已恢复。'), 'good'); await refresh(); } catch (error) { toast(text(error.message, '无法处理更改'), 'bad'); } }

  async function openProject() { try { const result = await invoke('openProject'); if (result?.canceled) return; if (result?.ok === false) throw new Error(text(result.error, '项目打开失败')); toast('已打开同一真实项目目录，Harness 正在重新连接。', 'good'); await refresh(); } catch (error) { toast(text(error.message, '项目打开失败'), 'bad'); } }
  async function continueCodex() { try { const selected = text($('codexTaskSelect')?.value); const input = selected ? { threadId: selected } : {}; const result = await invoke('continueFromCodex', input); if (result?.ok === false) throw new Error(text(result.error, '无法继续')); toast(text(result?.status, '已从 Handoff 继续'), 'good'); await refresh(); } catch (error) { toast(text(error.message, 'Continue From Codex 失败'), 'bad'); } }
  async function handoffCodex() { try { const result = await invoke('prepareHandoffForCodex', {}); if (result?.ok === false) throw new Error(text(result.error, '无法准备 Handoff')); toast(text(result?.status, 'Handoff 已准备'), 'good'); await refresh(); } catch (error) { toast(text(error.message, 'Prepare Handoff 失败'), 'bad'); } }

  function handleAction(event) {
    const target = event.target.closest('[data-action]'); if (!target) return; const action = target.dataset.action;
    if (action === 'checkpoint') checkpoint(); else if (action === 'open-workspace') invoke('openPath', { kind: 'workspace' }).catch((error) => toast(error.message, 'bad')); else if (action === 'open-project') openProject(); else if (action === 'continue-codex') continueCodex(); else if (action === 'handoff-codex') handoffCodex(); else if (action === 'marketplace') invoke('openMarketplace').catch((error) => toast(error.message, 'bad')); else if (action === 'open-settings') invoke('openSettings').catch((error) => toast(error.message, 'bad')); else if (action === 'invoke-skill') invokeSkill(target.dataset.skillName); else if (action === 'accept-diff' || action === 'revert-diff') diffAction(action, target.dataset.diffId);
  }

  function keyboard(event) {
    const key = event.key.toLowerCase();
    const activeOverlay = document.querySelector('.overlay:not([hidden])');
    if (event.key === 'Tab' && activeOverlay) {
      const focusable = q('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', activeOverlay).filter((node) => node.offsetParent !== null);
      if (focusable.length) {
        const current = focusable.indexOf(document.activeElement);
        const next = event.shiftKey ? (current <= 0 ? focusable.length - 1 : current - 1) : (current + 1) % focusable.length;
        event.preventDefault(); focusable[next].focus();
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'j') { event.preventDefault(); setDock(!layout.dockOpen); if (layout.dockOpen) $('terminalInput')?.focus(); }
    else if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'b') { event.preventDefault(); setRail(!layout.railOpen); }
    else if ((event.ctrlKey || event.metaKey) && key === 'k') { event.preventDefault(); openOverlay('fileSearchOverlay', 'fileSearchInput'); }
    else if (event.key === 'Escape') { ['fileSearchOverlay', 'goalOverlay'].forEach((id) => { if (!$(id).hidden) closeOverlay(id); }); }
  }

  function init() {
    q('.mode-button').forEach((button) => button.addEventListener('click', () => modeSelected(button.dataset.mode)));
    q('[data-rail-tab]').forEach((button) => button.addEventListener('click', () => selectRailTab(button.dataset.railTab)));
    q('[data-dock-tab]').forEach((button) => button.addEventListener('click', () => { selectDockTab(button.dataset.dockTab); setDock(true); }));
    $('railToggle').addEventListener('click', () => setRail(!layout.railOpen)); $('railClose').addEventListener('click', () => setRail(false)); $('dockClose').addEventListener('click', () => setDock(false)); $('fileSearchButton').addEventListener('click', () => openOverlay('fileSearchOverlay', 'fileSearchInput')); $('attachButton').addEventListener('click', attach); $('settingsButton').addEventListener('click', () => invoke('openSettings').catch((error) => toast(error.message, 'bad')));
    $('goalForm').addEventListener('submit', goalSubmitted); $('terminalForm').addEventListener('submit', (event) => { event.preventDefault(); runTerminal($('terminalInput').value); }); $('skillSearch').addEventListener('input', () => renderSkills());
    $('fileSearchInput').addEventListener('input', (event) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => searchFiles(event.target.value), 120); }); $('fileSearchInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') { const selected = document.querySelector('.file-result.is-selected'); if (selected) { event.preventDefault(); insertFile(selected.dataset.filePath); } } });
    q('[data-close-overlay]').forEach((button) => button.addEventListener('click', () => closeOverlay(button.dataset.closeOverlay))); document.addEventListener('click', handleAction); document.addEventListener('keydown', keyboard);
    if (typeof api.onState === 'function') { try { api.onState((next) => { state = normalizeState(next); render(); }); } catch { /* optional subscription */ } }
    if (typeof api.onLayout === 'function') { try { api.onLayout((next) => { const incoming = asObject(next); layout = { ...layout, ...incoming, railOpen: incoming.railOpen === undefined ? layout.railOpen : Boolean(incoming.railOpen), dockOpen: incoming.dockOpen === undefined ? layout.dockOpen : Boolean(incoming.dockOpen) }; render(); }); } catch { /* optional subscription */ } }
    render(); refresh(); window.setInterval(refresh, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
