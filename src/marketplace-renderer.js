(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const q = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const api = window.marketplace || {};
  const asObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const asArray = (value) => Array.isArray(value) ? value : [];
  const text = (value, fallback = '') => value === undefined || value === null ? fallback : String(value);
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const state = { installed: [], marketplace: [], activeTab: 'installed', query: '', loading: false, progress: {}, inspected: null };
  let searchTimer;
  let lastFocused;

  function invoke(name, payload) {
    if (typeof api[name] !== 'function') return Promise.reject(new Error(`Marketplace API unavailable: ${name}`));
    return Promise.resolve(api[name](payload));
  }

  function normalizePlugin(input) {
    const plugin = asObject(input);
    const repository = asObject(plugin.repository);
    const compatibility = plugin.compatibility ?? plugin.compatible;
    const compatibilityText = compatibility && typeof compatibility === 'object' ? Object.entries(compatibility).map(([key, value]) => `${key}: ${value}`).join(' · ') : compatibility;
    const id = text(plugin.id || plugin.slug || plugin.name || plugin.repo || repository.url);
    return {
      ...plugin,
      id,
      name: text(plugin.name || plugin.displayName || id, '未命名插件'),
      repo: text(plugin.repo || plugin.repositoryUrl || repository.full_name || repository.fullName || repository.url || repository.name),
      description: text(plugin.description || plugin.summary, '暂无描述'),
      stars: plugin.stars ?? plugin.stargazers_count,
      language: plugin.language || plugin.primaryLanguage,
      license: plugin.license?.spdx_id || plugin.license?.name || plugin.license,
      compatibility: Array.isArray(compatibilityText) ? compatibilityText.join(' · ') : compatibilityText,
      verified: plugin.verified === true,
      homepage: text(plugin.homepage || plugin.url || plugin.html_url || plugin.repoUrl || (typeof plugin.repository === 'string' ? plugin.repository : '') || (typeof plugin.repo === 'string' && /^https?:\/\//i.test(plugin.repo) ? plugin.repo : '')),
      status: text(plugin.status || plugin.state),
    };
  }

  function extractList(result, key) {
    if (Array.isArray(result)) return result.map(normalizePlugin);
    const outer = asObject(result);
    const object = outer.value && typeof outer.value === 'object' ? asObject(outer.value) : outer;
    return asArray(object[key] || object.plugins || object.items || object.results).map(normalizePlugin);
  }

  function toast(message, kind = '') {
    if (!message) return;
    const node = document.createElement('div'); node.className = `toast ${kind}`; node.textContent = text(message); $('toastRegion').append(node);
    window.setTimeout(() => node.remove(), 3800);
  }

  function setMeta(id, value) {
    const node = $(id);
    if (!node) return;
    const usable = value !== undefined && value !== null && value !== '';
    node.hidden = !usable;
    node.textContent = usable ? text(value) : '';
  }

  function icon(name) {
    const svg = document.createElement('svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const paths = {
      star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"></path>',
      code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"></path>',
      license: '<path d="M5 4.5h14v15H5zM8 8h8M8 12h8M8 16h4"></path>',
      check: '<path d="m5 12 4.2 4L19 6"></path>',
      folder: '<path d="M3.5 6.5h6l1.5 2h9.5v9H3.5z"></path>',
    };
    svg.innerHTML = paths[name] || paths.code; return svg;
  }

  function createMetadata(plugin) {
    const metadata = document.createElement('div'); metadata.className = 'plugin-metadata';
    const fields = [
      plugin.stars !== undefined && plugin.stars !== null ? ['star', text(plugin.stars)] : null,
      plugin.language ? ['code', plugin.language] : null,
      plugin.license ? ['license', plugin.license] : null,
      plugin.compatibility ? ['check', plugin.compatibility] : null,
    ].filter(Boolean);
    if (!fields.length) { metadata.hidden = true; return metadata; }
    for (const [type, value] of fields) { const item = document.createElement('span'); item.className = `metadata-item ${type === 'check' ? 'compatibility' : ''}`; item.append(icon(type)); item.append(document.createTextNode(value)); metadata.append(item); }
    return metadata;
  }

  function actionButton(label, action, plugin, className = '') {
    const button = document.createElement('button'); button.type = 'button'; button.className = `card-button ${className}`; button.dataset.action = action; button.dataset.pluginId = plugin.id; button.textContent = label; return button;
  }

  function createCard(plugin, installed = false) {
    const card = document.createElement('article'); const progress = state.progress[plugin.id]; const status = text(plugin.status).toLowerCase();
    card.className = `plugin-card ${progress ? 'is-progressing' : ''}`; card.dataset.pluginId = plugin.id;
    const header = document.createElement('div'); header.className = 'plugin-card-header';
    const identity = document.createElement('div'); identity.className = 'plugin-identity';
    const avatar = document.createElement('span'); avatar.className = 'plugin-avatar'; avatar.textContent = text(plugin.name, '?').trim().slice(0, 1).toUpperCase();
    const names = document.createElement('div'); const name = document.createElement('div'); name.className = 'plugin-name'; name.textContent = plugin.name; const repo = document.createElement('div'); repo.className = 'plugin-repo'; repo.textContent = plugin.repo || '本地插件'; names.append(name, repo); identity.append(avatar, names); header.append(identity);
    if (plugin.verified === true && !installed) { const verified = document.createElement('span'); verified.className = 'verified-mark'; verified.append(icon('check'), document.createTextNode('已验证')); header.append(verified); }
    const description = document.createElement('p'); description.className = 'plugin-description'; description.textContent = plugin.description;
    const metadata = createMetadata(plugin);
    const footer = document.createElement('div'); footer.className = 'plugin-card-footer';
    const statusNode = document.createElement('span'); statusNode.className = `plugin-status ${status === 'installed' ? 'is-installed' : status === 'updating' || progress ? 'is-updating' : status === 'error' || status === 'failed' ? 'is-error' : ''}`;
    if (progress) statusNode.textContent = `安装中 ${Math.round(progress.percent)}%`; else if (installed) statusNode.textContent = plugin.status || '已安装'; else statusNode.textContent = plugin.compatibility ? '可查看兼容性' : '';
    const actions = document.createElement('div'); actions.className = 'card-actions';
    if (installed) { actions.append(actionButton('打开目录', 'open-folder', plugin), actionButton('卸载', 'uninstall', plugin, 'danger')); }
    else if (progress) { const cancel = actionButton('进行中', 'noop', plugin); cancel.disabled = true; actions.append(cancel); }
    else if (plugin.verified === true) actions.append(actionButton('安装', 'install', plugin, 'primary'));
    else actions.append(actionButton('查看', 'inspect', plugin));
    footer.append(statusNode, actions); card.append(header, description, metadata, footer);
    if (progress) { const track = document.createElement('div'); track.className = 'progress-track'; const value = document.createElement('div'); value.className = 'progress-value'; value.style.width = `${Math.max(0, Math.min(100, progress.percent))}%`; track.append(value); card.append(track); }
    return card;
  }

  function renderList(id, plugins, options = {}) {
    const list = $(id); list.replaceChildren();
    if (!plugins.length) { const empty = document.createElement('div'); empty.className = 'empty-state'; const strong = document.createElement('strong'); strong.textContent = options.title || '没有找到插件'; const hint = document.createElement('span'); hint.textContent = options.hint || '当前没有可显示的内容。'; empty.append(strong, hint); list.append(empty); return; }
    for (const plugin of plugins) list.append(createCard(plugin, Boolean(options.installed)));
  }

  function render() {
    const query = state.query.trim().toLowerCase();
    const installed = state.installed.filter((plugin) => !query || JSON.stringify(plugin).toLowerCase().includes(query));
    renderList('installedList', installed, { installed: true, title: '没有已安装插件', hint: query ? '换个关键词试试。' : '当前 Workspace 还没有已安装插件。' });
    const market = state.marketplace.filter((plugin) => !query || JSON.stringify(plugin).toLowerCase().includes(query));
    renderList('marketList', market, { title: query ? '没有匹配的插件' : '插件市场暂无结果', hint: query ? '换个关键词或检查搜索服务。' : '点击刷新或输入关键词搜索市场。' });
    q('[data-panel]').forEach((panel) => { const active = panel.dataset.panel === state.activeTab; panel.hidden = !active; panel.classList.toggle('is-active', active); });
    q('[data-tab]').forEach((tab) => { const active = tab.dataset.tab === state.activeTab; tab.classList.toggle('is-active', active); tab.setAttribute('aria-selected', String(active)); });
    setMeta('installedMeta', state.installed.length ? `${state.installed.length} 个` : '');
    const rawMarketTotal = state.marketTotal;
    setMeta('marketMeta', Number.isFinite(Number(rawMarketTotal)) ? `${rawMarketTotal} 个结果` : '');
  }

  async function loadInstalled() {
    try { const result = await invoke('listInstalled'); state.installed = extractList(result, 'installed'); render(); }
    catch (error) { state.installed = []; render(); toast(text(error.message, '无法读取本地插件'), 'bad'); }
  }

  async function searchMarketplace() {
    state.loading = true; setText('progressStatus', '正在搜索…');
    try { const result = await invoke('searchMarketplace', { query: state.query.trim() }); const outer = asObject(result); const object = outer.value && typeof outer.value === 'object' ? asObject(outer.value) : outer; state.marketplace = extractList(result, 'plugins'); state.marketTotal = object.total; render(); }
    catch (error) { state.marketplace = []; render(); toast(text(error.message, '插件市场暂时不可用'), 'bad'); }
    finally { state.loading = false; setText('progressStatus', ''); }
  }

  function setText(id, value) { const node = $(id); if (node) node.textContent = text(value); }

  async function refresh() { if (state.activeTab === 'installed') await loadInstalled(); else await searchMarketplace(); }

  function openInspect(plugin, details = plugin) {
    lastFocused = document.activeElement; state.inspected = normalizePlugin(details); const value = state.inspected; const body = $('inspectBody'); body.replaceChildren(); const title = document.createElement('h3'); title.textContent = value.name; const desc = document.createElement('p'); desc.textContent = value.description; const grid = document.createElement('dl'); grid.className = 'inspect-detail-grid'; const fields = [['仓库', value.repo], ['Stars', value.stars], ['语言', value.language], ['许可证', value.license], ['兼容性', value.compatibility], ['状态', value.status || (value.verified ? '已验证来源' : '未验证来源')]]; for (const [key, val] of fields) { if (val === undefined || val === null || val === '') continue; const dt = document.createElement('dt'); dt.textContent = key; const dd = document.createElement('dd'); dd.textContent = text(val); grid.append(dt, dd); } body.append(title, desc, grid); const external = $('inspectExternal'); const url = /^https?:\/\//i.test(value.homepage) ? value.homepage : ''; external.hidden = !url; external.dataset.externalUrl = url; $('inspectTitle').textContent = value.name; $('inspectOverlay').hidden = false; window.setTimeout(() => $('inspectOverlay').querySelector('[data-close-inspect]')?.focus(), 0); }

  async function inspect(plugin) { try { const result = await invoke('inspectPlugin', { id: plugin.id, plugin }); const details = asObject(result).plugin || result || plugin; openInspect(plugin, details); } catch (error) { openInspect(plugin); toast(text(error.message, '详情读取失败，已显示可用信息'), 'warn'); } }
  async function install(plugin) { if (plugin.verified !== true) { await inspect(plugin); return; } state.progress[plugin.id] = { percent: 0 }; render(); setText('progressStatus', `正在安装 ${plugin.name}…`); try { const result = await invoke('installPlugin', { id: plugin.id, plugin }); if (result?.ok === false) throw new Error(text(result.error, '安装失败')); delete state.progress[plugin.id]; toast(text(result?.status, `${plugin.name} 已安装`), 'good'); await loadInstalled(); } catch (error) { delete state.progress[plugin.id]; render(); toast(text(error.message, '插件安装失败'), 'bad'); } finally { setText('progressStatus', ''); } }
  async function uninstall(plugin) { const first = window.confirm(`确定要卸载“${plugin.name}”吗？`); if (!first) return; const second = window.confirm(`再次确认：卸载后将从当前 Harness 插件目录移除“${plugin.name}”。`); if (!second) return; try { const result = await invoke('uninstallPlugin', { id: plugin.id, plugin }); if (result?.ok === false) throw new Error(text(result.error, '卸载失败')); toast(text(result?.status, `${plugin.name} 已卸载`), 'good'); await loadInstalled(); } catch (error) { toast(text(error.message, '插件卸载失败'), 'bad'); } }
  async function openFolder(plugin) { try { const result = await invoke('openPluginFolder', { id: plugin.id, plugin }); if (result?.ok === false) throw new Error(text(result.error, '目录不可用')); } catch (error) { toast(text(error.message, '无法打开插件目录'), 'bad'); } }
  async function openExternal(url) { if (!/^https?:\/\//i.test(url)) return; try { await invoke('openExternal', { url }); } catch (error) { toast(text(error.message, '无法打开项目主页'), 'bad'); } }

  function closeInspect() { $('inspectOverlay').hidden = true; if (lastFocused && document.contains(lastFocused)) lastFocused.focus(); state.inspected = null; }
  function handleAction(event) { const target = event.target.closest('[data-action]'); if (!target) return; const plugin = [...state.installed, ...state.marketplace].find((item) => item.id === target.dataset.pluginId); if (!plugin) return; switch (target.dataset.action) { case 'inspect': inspect(plugin); break; case 'install': install(plugin); break; case 'uninstall': uninstall(plugin); break; case 'open-folder': openFolder(plugin); break; } }
  function selectTab(tab, focus = true) { if (!['installed', 'market'].includes(tab)) return; state.activeTab = tab; render(); if (tab === 'market') searchMarketplace(); if (focus) document.querySelector(`[data-tab="${CSS.escape(tab)}"]`)?.focus(); }
  function keyboard(event) { const key = event.key.toLowerCase(); const overlay = $('inspectOverlay'); if (event.key === 'Escape' && !overlay.hidden) { event.preventDefault(); closeInspect(); return; } if (event.key === 'Tab' && !overlay.hidden) { const focusable = q('button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])', overlay).filter((node) => node.offsetParent !== null); if (focusable.length) { const current = focusable.indexOf(document.activeElement); const next = event.shiftKey ? (current <= 0 ? focusable.length - 1 : current - 1) : (current + 1) % focusable.length; event.preventDefault(); focusable[next].focus(); } return; } if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && document.activeElement?.matches('[data-tab]')) { const tabs = q('[data-tab]'); const index = tabs.indexOf(document.activeElement); const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length; event.preventDefault(); selectTab(tabs[next].dataset.tab); return; } if ((event.ctrlKey || event.metaKey) && key === 'k') { event.preventDefault(); $('searchInput').focus(); } }

  function init() {
    q('[data-tab]').forEach((tab) => tab.addEventListener('click', () => selectTab(tab.dataset.tab)));
    $('searchInput').addEventListener('input', (event) => { state.query = event.target.value; render(); clearTimeout(searchTimer); if (state.activeTab === 'market') searchTimer = setTimeout(searchMarketplace, 280); });
    $('refreshButton').addEventListener('click', refresh); $('toolbarRefresh').addEventListener('click', refresh); $('closeButton').addEventListener('click', () => { try { window.close(); } catch { /* host may own close */ } });
    q('[data-close-inspect]').forEach((button) => button.addEventListener('click', closeInspect)); $('inspectExternal').addEventListener('click', () => openExternal($('inspectExternal').dataset.externalUrl)); document.addEventListener('click', handleAction); document.addEventListener('keydown', keyboard);
    if (typeof api.onProgress === 'function') { try { api.onProgress((event) => { const progress = asObject(event); const id = text(progress.id || progress.pluginId); if (!id) return; const rawPercent = number(progress.percent ?? progress.progress); const percent = rawPercent >= 0 && rawPercent <= 1 ? rawPercent * 100 : rawPercent; state.progress[id] = { percent: Math.max(0, Math.min(100, percent)), status: text(progress.status) }; render(); setText('progressStatus', progress.status || `正在处理 ${Math.round(state.progress[id].percent)}%`); }); } catch { /* optional progress stream */ } }
    render(); loadInstalled();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
