(() => {
  const $ = (id) => document.getElementById(id);
  const message = (text, kind = '') => { $('message').textContent = text; $('message').className = kind; };
  const status = (id, text, kind = '') => { const node = $(id); node.textContent = text; node.className = `status ${kind}`; };
  const set = (id, value, fallback = '') => { const node = $(id); if (!node) return; node.value = value == null ? fallback : value; };
  const check = (id, value) => { const node = $(id); if (node) node.checked = Boolean(value); };
  const list = (value) => Array.isArray(value) ? value.join(', ') : String(value || '');
  let loaded;
  let levelMap = new Map();
  const permissionMap = {
    'read-only': { workspaceWrite: false, terminal: false, browser: false },
    'safe-coding': { workspaceWrite: true, terminal: true, browser: false },
    'full-workspace': { workspaceWrite: true, terminal: true, browser: false },
    'browser-agent': { workspaceWrite: true, terminal: true, browser: true },
    'full-agent': { workspaceWrite: true, terminal: true, browser: true },
  };
  function fill(value) {
    loaded = value || {};
    const d = loaded.deepseek || {}; const v = loaded.vision || {}; const w = loaded.workspace || {}; const debug = loaded.debug || {};
    const g = loaded.general || {}; const a = loaded.appearance || {}; const p = loaded.personalization || {}; const agent = loaded.agent || {}; const permissions = loaded.permissions || {}; const b = loaded.browser || {}; const advanced = loaded.advanced || {};
    set('deepseekBaseURL', d.baseURL, 'https://api.deepseek.com'); set('deepseekModel', d.model, 'deepseek-v4-flash');
    check('visionEnabled', v.enabled); set('visionProvider', v.provider, 'siliconflow'); set('visionBaseURL', v.baseURL, 'https://api.siliconflow.cn/v1/chat/completions'); set('visionModel', v.model, 'zai-org/GLM-4.5V');
    set('workspacePath', w.path); check('allowShell', w.allowShell !== false); check('debugEnabled', debug.enabled);
    set('agentLevel', agent.level, 'medium'); set('agentBudgetOverride', agent.budgetOverride, 0); updateLevelDescription();
    set('launchBehavior', g.launchBehavior, 'restore'); set('enterBehavior', g.enterBehavior, 'send'); set('defaultPreset', g.defaultPreset, 'deepseek-desktop'); set('downloadDir', g.downloadDir); set('tempDir', g.tempDir); check('startOnBoot', g.startOnBoot); check('closeToTray', g.closeToTray); check('restoreWorkspace', g.restoreWorkspace !== false); check('autoUpdateCheck', g.autoUpdateCheck !== false); check('restoreSession', g.restoreSession !== false);
    set('theme', a.theme, 'dark'); set('sidebarDensity', a.sidebarDensity, 'comfortable'); set('scale', a.scale, 100); set('fontSize', a.fontSize, 14); set('codeFont', a.codeFont); set('editorFont', a.editorFont); check('compact', a.compact); check('animations', a.animations !== false);
    set('globalInstructions', p.globalInstructions); set('workspaceInstructions', p.workspaceInstructions); set('language', p.language, 'zh-CN'); set('commentLanguage', p.commentLanguage, 'same-as-code'); set('codingStyle', p.codingStyle, 'pragmatic'); check('preferExplain', p.preferExplain !== false); check('autoTest', p.autoTest !== false); check('autoSummary', p.autoSummary !== false);
    set('permissionPreset', permissions.preset, 'safe-coding'); check('workspaceWrite', permissions.workspaceWrite); check('terminalPermission', permissions.terminal); check('browserPermission', permissions.browser); check('confirmDestructive', permissions.confirmDestructive !== false);
    check('browserEnabled', b.enabled); set('browserHeadless', String(b.headless !== false)); set('browserExecutable', b.executable); set('browserDownloadDir', b.downloadDir); set('browserScreenshotQuality', b.screenshotQuality, 80); set('cookiePolicy', b.cookiePolicy, 'isolated'); set('allowedDomains', list(b.allowedDomains)); set('blockedDomains', list(b.blockedDomains)); check('confirmDownloads', b.confirmDownloads !== false); check('confirmUploads', b.confirmUploads !== false);
    check('dynamicPort', advanced.dynamicPort !== false); set('harnessPort', advanced.harnessPort, 0); set('startupTimeoutMs', advanced.startupTimeoutMs, 60000); set('requestTimeoutMs', advanced.requestTimeoutMs, 20000); set('retry', advanced.retry, 2); set('loggingLevel', advanced.loggingLevel, 'info'); check('developerMode', advanced.developerMode); set('proxy', advanced.proxy);
    $('deepseekKeyState').textContent = d.apiKeyConfigured ? `已配置（${d.apiKeyMasked}）· 留空以保留` : '未配置'; $('visionKeyState').textContent = v.apiKeyConfigured ? `已配置（${v.apiKeyMasked}）` : (v.enabled ? 'Awaiting API Key' : 'Vision Disabled');
    if (loaded.dataPaths) $('dataPaths').textContent = `应用数据：${loaded.dataPaths.userData}\n日志：${loaded.dataPaths.logs}\nUsage：${loaded.dataPaths.usage}\nWorkspace：${loaded.dataPaths.workspace || '默认路径'}`;
    if (loaded.app) $('aboutInfo').textContent = `Desktop ${loaded.app.desktopVersion} · Electron ${loaded.app.electron} · Node ${loaded.app.node} · Official Harness ${loaded.app.harness}\nThird-party desktop application based on the official DeepSeek Harness Web profile.`;
  }
  function updateLevelDescription() { const value = levelMap.get($('agentLevel').value); $('agentLevelDescription').textContent = value ? `${value.description} Provider effort: ${value.reasoningEffort}; max parallel tools: ${value.maxParallelToolCalls}; max steps: ${value.maxSteps}.` : ''; }
  function csv(id) { return $(id).value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean); }
  function collect() {
    return {
      deepseek: { baseURL: $('deepseekBaseURL').value.trim(), model: $('deepseekModel').value },
      vision: { enabled: $('visionEnabled').checked, provider: $('visionProvider').value, baseURL: $('visionBaseURL').value.trim(), model: $('visionModel').value.trim() },
      workspace: { path: $('workspacePath').value.trim(), allowShell: $('allowShell').checked }, debug: { enabled: $('debugEnabled').checked },
      general: { launchBehavior: $('launchBehavior').value, startOnBoot: $('startOnBoot').checked, closeToTray: $('closeToTray').checked, restoreWorkspace: $('restoreWorkspace').checked, enterBehavior: $('enterBehavior').value, defaultPreset: $('defaultPreset').value.trim(), autoUpdateCheck: $('autoUpdateCheck').checked, restoreSession: $('restoreSession').checked, downloadDir: $('downloadDir').value.trim(), tempDir: $('tempDir').value.trim() },
      appearance: { theme: $('theme').value, scale: Number($('scale').value), fontSize: Number($('fontSize').value), compact: $('compact').checked, sidebarDensity: $('sidebarDensity').value, animations: $('animations').checked, codeFont: $('codeFont').value, editorFont: $('editorFont').value },
      personalization: { globalInstructions: $('globalInstructions').value, workspaceInstructions: $('workspaceInstructions').value, language: $('language').value, commentLanguage: $('commentLanguage').value, codingStyle: $('codingStyle').value, preferExplain: $('preferExplain').checked, autoTest: $('autoTest').checked, autoSummary: $('autoSummary').checked },
      agent: { level: $('agentLevel').value, budgetOverride: Number($('agentBudgetOverride').value) || 0 },
      permissions: { preset: $('permissionPreset').value, workspaceWrite: $('workspaceWrite').checked, terminal: $('terminalPermission').checked, browser: $('browserPermission').checked, computer: false, confirmDestructive: $('confirmDestructive').checked },
      browser: { enabled: $('browserEnabled').checked, headless: $('browserHeadless').value === 'true', executable: $('browserExecutable').value.trim(), downloadDir: $('browserDownloadDir').value.trim(), screenshotQuality: Number($('browserScreenshotQuality').value), allowedDomains: csv('allowedDomains'), blockedDomains: csv('blockedDomains'), cookiePolicy: $('cookiePolicy').value, confirmDownloads: $('confirmDownloads').checked, confirmUploads: $('confirmUploads').checked },
      advanced: { dynamicPort: $('dynamicPort').checked, harnessPort: Number($('harnessPort').value) || 0, startupTimeoutMs: Number($('startupTimeoutMs').value) || 60000, requestTimeoutMs: Number($('requestTimeoutMs').value) || 20000, retry: Number($('retry').value) || 0, loggingLevel: $('loggingLevel').value, developerMode: $('developerMode').checked, proxy: $('proxy').value.trim() },
    };
  }
  async function load() { try { levelMap = new Map((await window.settings.agentLevels()).map((item) => [item.id, item])); fill(await window.settings.load()); } catch (error) { message(error.message, 'danger'); } }
  $('agentLevel').addEventListener('change', updateLevelDescription);
  $('permissionPreset').addEventListener('change', () => { const value = permissionMap[$('permissionPreset').value]; if (!value) return; check('workspaceWrite', value.workspaceWrite); check('terminalPermission', value.terminal); check('browserPermission', value.browser); });
  $('save').addEventListener('click', async () => {
    const value = collect(); if ($('deepseekApiKey').value) value.deepseekApiKey = $('deepseekApiKey').value; if ($('visionApiKey').value) value.visionApiKey = $('visionApiKey').value;
    $('save').disabled = true; message('正在保存并重启（密钥不会显示）...');
    try { fill(await window.settings.save(value)); $('deepseekApiKey').value = ''; $('visionApiKey').value = ''; message('已保存，Harness 后端正在重启。', 'good'); } catch (error) { message(error.message, 'danger'); } finally { $('save').disabled = false; }
  });
  $('clear').addEventListener('click', async () => { if (!confirm('清除 DeepSeek 和 Vision 两组 API Key？')) return; try { fill(await window.settings.clearSecrets()); message('两组密钥已从 DPAPI 存储删除。', 'good'); } catch (error) { message(error.message, 'danger'); } });
  $('testDeepSeek').addEventListener('click', async () => { status('deepseekStatus', '正在调用 /models 和最小 chat...'); try { const result = await window.settings.testDeepSeek(); status('deepseekStatus', result.ok ? `${result.status} · ${result.model}` : `${result.code || 'Failed'}: ${result.error || result.status}`, result.ok ? 'good' : 'bad'); } catch (error) { status('deepseekStatus', error.message, 'bad'); } });
  $('testVision').addEventListener('click', async () => { status('visionStatus', '正在调用 Vision provider...'); try { const result = await window.settings.testVision(); status('visionStatus', result.ok ? `${result.status} · ${result.model}` : `${result.code || 'Failed'}: ${result.error || result.status}`, result.ok ? 'good' : (result.code === 'MISSING_CREDENTIAL' ? 'warn' : 'bad')); } catch (error) { status('visionStatus', error.message, 'bad'); } });
  $('openLogs').addEventListener('click', () => window.settings.openLogs().then((result) => message(result.ok ? '已打开日志目录。' : result.error, result.ok ? 'good' : 'danger')).catch((error) => message(error.message, 'danger')));
  $('clearVisionCache').addEventListener('click', async () => { if (!confirm('清除 Vision 缓存？')) return; const result = await window.settings.clearVisionCache(); message(result.ok ? 'Vision 缓存已清理。' : result.error, result.ok ? 'good' : 'danger'); });
  $('openUsage').addEventListener('click', () => window.settings.openUsage());
  $('exportProfile').addEventListener('click', () => window.settings.exportProfile().then((r) => message(r.ok ? 'Profile 已导出（不含密钥）。' : '已取消。', r.ok ? 'good' : '')).catch((e) => message(e.message, 'danger')));
  $('importProfile').addEventListener('click', () => window.settings.importProfile().then((r) => { if (r.ok) { fill(r.settings); message('Profile 已导入并重启 Harness。', 'good'); } }).catch((e) => message(e.message, 'danger')));
  $('exportData').addEventListener('click', () => window.settings.exportData().then((r) => message(r.ok ? '数据已导出（不含 Workspace 源码和密钥）。' : '已取消。', r.ok ? 'good' : '')).catch((e) => message(e.message, 'danger')));
  $('openData').addEventListener('click', () => window.settings.openData().then((r) => message(r.ok ? '已打开应用数据目录。' : r.error, r.ok ? 'good' : 'danger')));
  const clearAction = (id, api, prompt) => $(id).addEventListener('click', async () => { if (!confirm(prompt)) return; try { const result = await window.settings[api](); message(result.ok === false ? result.error : '清理完成。', result.ok === false ? 'danger' : 'good'); } catch (error) { message(error.message, 'danger'); } });
  clearAction('clearUsageData', 'clearUsage', '清除本地 Usage 历史？Workspace 和 API Key 不受影响。'); clearAction('clearLogsData', 'clearLogs', '清除 Desktop 日志？'); clearAction('clearSessionsData', 'clearSessions', '清除 Harness Session 历史？不会删除 Workspace 源码。'); clearAction('clearHandoffData', 'clearHandoffHistory', '清除 .agents/sessions Handoff 历史？'); clearAction('clearCacheData', 'clearCache', '清除 Desktop 缓存（包括 Vision/Browser 缓存）？');
  $('close').addEventListener('click', () => window.settings.close());
  load();
})();
