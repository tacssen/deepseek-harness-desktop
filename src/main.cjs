const { app, BrowserWindow, WebContentsView, Menu, Tray, nativeImage, ipcMain, safeStorage, dialog, shell } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const { spawn } = require('node:child_process');
const YAML = require('yaml');
const { SecureStore } = require('./secure-store.cjs');
const { Logger, redact } = require('./logger.cjs');
const { VisionBridge } = require('./vision-bridge.cjs');
const { WorkbenchService } = require('./workbench-service.cjs');
const { MarketplaceService } = require('./marketplace-service.cjs');
const { AppDataService } = require('./app-data-service.cjs');
const { getAgentLevel, listAgentLevels } = require('./agent-levels.cjs');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow;
  let harnessView;
  let settingsWindow;
  let marketplaceWindow;
  let usageWindow;
  let tray;
  let backend;
  let backendPort;
  let stopping = false;
  let logger;
  let store;
  let appData;
  let vision;
  let workbench;
  let marketplace;
  let workspaceRoot;
  let dshHome;
  let workbenchLayout = { railOpen: true, dockOpen: false, railWidth: 336, dockHeight: 250 };
  const importDeepSeekKey = process.argv.includes('--import-deepseek-key-stdin');
  const importVisionKey = process.argv.includes('--import-vision-key-stdin');
  const testVisionOnce = process.argv.includes('--test-vision-once');
  const testDeepSeekOnce = process.argv.includes('--test-deepseek-once');
  const workspaceArgument = process.argv.find((value) => value.startsWith('--workspace='));
  const workspaceOverride = workspaceArgument ? path.resolve(workspaceArgument.slice('--workspace='.length)) : null;

  app.setAppUserModelId('ai.deepseek.harness.desktop');

  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    if (argv.includes('--settings')) openSettingsWindow();
  });

  app.whenReady().then(async () => {
    logger = new Logger(app);
    logger.info(`DeepSeek Harness Desktop starting; Electron ${process.versions.electron}, Node ${process.versions.node}`);
    store = new SecureStore(app, safeStorage, (message) => logger.warn(message));
    store.load();
    appData = new AppDataService(app, logger);
    appData.load();
    vision = new VisionBridge(app, store, logger, { onUsage: (record) => appData.recordUsage(record).catch((error) => logger.warn(`vision usage write failed: ${error.code || error.message}`)) });
    if (testVisionOnce) {
      const result = await vision.test(store.publicSettings().vision);
      process.stdout.write(`${JSON.stringify({ ok: result.ok, status: result.status, model: result.model, code: result.code })}\n`);
      await logger.queue;
      app.exit(result.ok ? 0 : 1);
      return;
    }
    if (testDeepSeekOnce) {
      await prepareWorkspace();
      const result = await testDeepSeek();
      process.stdout.write(`${JSON.stringify({ ok: result.ok, status: result.status, model: result.model, code: result.code })}\n`);
      await logger.queue;
      app.exit(result.ok ? 0 : 1);
      return;
    }
    if (importDeepSeekKey || importVisionKey) {
      try {
        const key = await readSecretStdin();
        if (importVisionKey) {
          await store.save({ visionApiKey: key, vision: { enabled: true, provider: 'siliconflow', baseURL: 'https://api.siliconflow.cn/v1/chat/completions', model: 'zai-org/GLM-4.5V' } });
        } else {
          await store.save({ deepseekApiKey: key });
        }
        process.stdout.write('CREDENTIAL_SAVED\n');
        app.exit(0);
      } catch (error) {
        logger.error(`credential import failed: ${error.code || error.message}`);
        await logger.queue;
        process.stdout.write('CREDENTIAL_NOT_SAVED\n');
        app.exit(1);
      }
      return;
    }
    await prepareWorkspace();
    applyLoginItemSetting();
    workbench = new WorkbenchService({ app, logger, getPort: () => backendPort, getWorkspace: () => workspaceRoot, usage: appData, getPreferences: () => store.getPreferences() });
    marketplace = new MarketplaceService({ app, logger, getWorkspace: () => workspaceRoot, getDshHome: () => dshHome, verifiedAllowlist: {}, progress: (value) => marketplaceWindow?.webContents.send('marketplace:progress', value) });
    registerWorkbenchIpc();
    registerMarketplaceIpc();
    createMenu();
    try {
      await startBackend();
      createMainWindow();
      setupTray();
      logger.info(`Harness ready at http://127.0.0.1:${backendPort}/`);
    } catch (error) {
      logger.error(`Harness failed to start: ${error.code || error.message}`);
      await showStartupFailure(error);
    }
  }).catch((error) => {
    if (logger) logger.error(`Electron startup failed: ${error.code || error.message}`);
  });

  app.on('activate', () => {
    if (mainWindow) mainWindow.show();
    else if (backendPort) createMainWindow();
  });

  app.on('before-quit', (event) => {
    if (stopping) return;
    stopping = true;
    event.preventDefault();
    if (tray) { tray.destroy(); tray = undefined; }
    closeUsageWindow();
    closeSettingsWindow();
    Promise.allSettled([workbench?.close(), stopBackend()]).finally(() => { app.exit(0); });
  });

  ipcMain.handle('get-status', () => ({ backend: Boolean(backend && backend.exitCode === null), port: backendPort || null, settings: store.publicSettings(), vision: vision.status() }));
  ipcMain.handle('open-settings', () => { openSettingsWindow(); return true; });
  ipcMain.handle('settings-load', () => decorateSettings(store.publicSettings()));
  ipcMain.handle('settings-save', async (_event, input) => {
    const publicSettings = await store.save(sanitizeSettingsInput(input));
    applyLoginItemSetting();
    await prepareWorkspace();
    await restartBackend();
    if (store.getPreferences().general.closeToTray) setupTray();
    return decorateSettings(publicSettings);
  });
  ipcMain.handle('clear-secrets', async () => {
    const publicSettings = await store.clearSecrets();
    await restartBackend();
    return publicSettings;
  });
  ipcMain.handle('settings-close', () => { closeSettingsWindow(); return true; });
  ipcMain.handle('open-logs', async () => {
    const folder = path.dirname(logger.file);
    const error = await shell.openPath(folder);
    return { ok: !error, error: error || undefined };
  });
  ipcMain.handle('clear-vision-cache', async () => {
    const cacheDir = vision?.cacheDir;
    if (!cacheDir) return { ok: false, error: 'Vision cache is not initialized' };
    // Keep this destructive action constrained to the app-owned cache folder.
    const expected = path.resolve(app.getPath('userData'), 'cache', 'vision');
    if (path.resolve(cacheDir) !== expected) return { ok: false, error: 'Refusing an unexpected cache path' };
    await fsp.rm(cacheDir, { recursive: true, force: true });
    vision.memory.clear();
    logger.info('Vision cache cleared');
    return { ok: true };
  });
  ipcMain.handle('test-deepseek', async () => testDeepSeek());
  ipcMain.handle('test-vision', async () => vision.test(store.publicSettings().vision));
  ipcMain.handle('vision-analyze', async (_event, input) => vision.analyze(input));
  ipcMain.handle('usage-snapshot', async () => ({ ...appData.summarize(), paths: appData.describePaths() }));
  ipcMain.handle('usage-clear', async () => appData.clearUsage());
  ipcMain.handle('usage-open-billing', async () => { await shell.openExternal('https://platform.deepseek.com/usage'); return { ok: true }; });
  ipcMain.handle('usage-close', () => { closeUsageWindow(); return true; });
  ipcMain.handle('agent-levels', () => listAgentLevels());
  ipcMain.handle('settings-export-profile', async () => {
    const selection = await dialog.showSaveDialog(settingsWindow || mainWindow, { title: '导出 Desktop Profile（不含密钥）', defaultPath: path.join(app.getPath('documents'), 'deepseek-harness-profile.json'), filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (selection.canceled || !selection.filePath) return { ok: false, canceled: true };
    await fsp.writeFile(selection.filePath, `${JSON.stringify(store.exportProfile(), null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return { ok: true, path: selection.filePath };
  });
  ipcMain.handle('settings-import-profile', async () => {
    const selection = await dialog.showOpenDialog(settingsWindow || mainWindow, { title: '导入 Desktop Profile（不含密钥）', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (selection.canceled || !selection.filePaths[0]) return { ok: false, canceled: true };
    const profile = JSON.parse(await fsp.readFile(selection.filePaths[0], 'utf8'));
    const value = await store.importProfile(profile);
    await prepareWorkspace();
    await restartBackend();
    applyLoginItemSetting();
    if (store.getPreferences().general.closeToTray) setupTray();
    return { ok: true, settings: decorateSettings(value) };
  });
  ipcMain.handle('settings-export-data', async () => {
    const selection = await dialog.showSaveDialog(settingsWindow || mainWindow, { title: '导出我的 Desktop 数据（不含密钥和 Workspace 源码）', defaultPath: path.join(app.getPath('documents'), 'deepseek-harness-data.json'), filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (selection.canceled || !selection.filePath) return { ok: false, canceled: true };
    const data = { schemaVersion: 1, exportedAt: new Date().toISOString(), preferences: store.exportProfile().preferences, appData: appData.exportData() };
    await fsp.writeFile(selection.filePath, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return { ok: true, path: selection.filePath };
  });
  ipcMain.handle('settings-open-data', async () => { const error = await shell.openPath(app.getPath('userData')); return { ok: !error, error: error || undefined }; });
  ipcMain.handle('settings-clear-usage', async () => appData.clearUsage());
  ipcMain.handle('settings-clear-logs', async () => { await fsp.writeFile(logger.file, '', 'utf8'); return { ok: true }; });
  ipcMain.handle('settings-clear-sessions', async () => {
    if (!dshHome) return { ok: false, error: 'Harness 数据目录尚未初始化' };
    const sessions = path.join(dshHome, 'sessions');
    await fsp.rm(sessions, { recursive: true, force: true });
    await fsp.rm(path.join(dshHome, 'storages', 'session_projcache.json'), { force: true });
    return { ok: true };
  });
  ipcMain.handle('settings-clear-handoff-history', async () => {
    if (!workspaceRoot) return { ok: false, error: 'Workspace 尚未初始化' };
    const history = path.join(workspaceRoot, '.agents', 'sessions');
    await fsp.rm(history, { recursive: true, force: true });
    return { ok: true };
  });
  ipcMain.handle('settings-clear-cache', async () => {
    const cache = path.join(app.getPath('userData'), 'cache');
    await fsp.rm(cache, { recursive: true, force: true });
    vision?.memory?.clear?.();
    return { ok: true };
  });
  ipcMain.handle('open-usage-window', () => { openUsageWindow(); return { ok: true }; });

  function registerWorkbenchIpc() {
    const handle = (name, fn) => ipcMain.handle(`workbench:${name}`, async (_event, input) => {
      const result = await fn(input || {});
      if (name !== 'getSnapshot' && mainWindow && !mainWindow.isDestroyed()) {
        workbench.getSnapshot().then((next) => mainWindow?.webContents.send('workbench:state', next)).catch(() => {});
      }
      return result;
    });
    handle('getSnapshot', () => workbench.getSnapshot());
    handle('setLayout', (input) => {
      workbenchLayout = sanitizeWorkbenchLayout(input);
      updateHarnessBounds();
      return workbenchLayout;
    });
    handle('setMode', (input) => workbench.setMode(input));
    handle('runTerminal', (input) => workbench.runTerminal(input));
    handle('listFiles', (input) => workbench.listFiles(input));
    handle('attachFiles', async () => {
      const selection = await dialog.showOpenDialog(mainWindow, {
        title: '添加工作区附件',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '常用文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'txt', 'md', 'json', 'yaml', 'yml', 'js', 'ts', 'py', 'ps1', 'pdf'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      });
      if (selection.canceled) return { files: [] };
      return workbench.attachFiles(selection.filePaths);
    });
    handle('insertReference', (input) => workbench.insertReference(input));
    handle('createCheckpoint', () => workbench.createCheckpoint());
    handle('restoreCheckpoint', (input) => workbench.restoreCheckpoint(input));
    handle('invokeSkill', (input) => workbench.invokeSkill(input));
    handle('revertDiff', (input) => workbench.revertDiff(input));
    handle('acceptDiff', (input) => workbench.acceptDiff(input));
    handle('initializeSharedProject', () => workbench.initializeSharedProject());
    handle('continueFromCodex', (input) => workbench.continueFromCodex(input));
    handle('prepareHandoffForCodex', (input) => workbench.prepareHandoffForCodex(input));
    handle('openProject', async () => {
      return chooseExistingProject();
    });
    handle('openMarketplace', () => { openMarketplaceWindow(); return { ok: true }; });
    handle('openSettings', () => { openSettingsWindow(); return { ok: true }; });
    handle('openUsage', () => { openUsageWindow(); return { ok: true }; });
    handle('openPath', async (input) => {
      const target = input?.kind === 'logs' ? path.dirname(logger.file) : workspaceRoot;
      const error = await shell.openPath(target);
      return { ok: !error, error: error || undefined };
    });
  }

  function createMenu() {
    const template = [
      { label: 'DeepSeek Harness', submenu: [{ label: '设置', accelerator: 'CmdOrCtrl+,', click: () => openSettingsWindow() }, { label: '重新启动 Harness 后端', click: () => restartBackend().catch((error) => showError(error)) }, { type: 'separator' }, { role: 'quit', label: '退出' }] },
      { label: '工作台', submenu: [{ label: '打开已有项目', click: () => chooseExistingProject().catch((error) => showError(error)) }, { label: '插件', click: () => openMarketplaceWindow() }, { type: 'separator' }, { label: '切换任务侧栏', accelerator: 'CmdOrCtrl+Shift+B', click: () => toggleWorkbenchPart('railOpen') }, { label: '切换底部面板', accelerator: 'CmdOrCtrl+J', click: () => toggleWorkbenchPart('dockOpen') }] },
      { label: '帮助', submenu: [{ label: '打开工作区', click: () => shell.openPath(workspaceRoot) }, { label: '打开日志目录', click: () => shell.openPath(path.dirname(logger.file)) }] },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  function registerMarketplaceIpc() {
    const handle = (name, fn) => ipcMain.handle(`marketplace:${name}`, async (_event, input) => fn(input || {}));
    handle('listInstalled', () => marketplace.listInstalled());
    handle('searchMarketplace', (input) => marketplace.searchMarketplace(input));
    handle('inspectPlugin', (input) => marketplace.inspectPlugin(input));
    handle('installPlugin', async (input) => { const result = await marketplace.installPlugin(input); await restartBackend(); return result; });
    handle('uninstallPlugin', async (input) => { const result = await marketplace.uninstallPlugin(input); await restartBackend(); return result; });
    handle('openExternal', async (input) => {
      let url; try { url = new URL(String(input.url || '')); } catch { throw new Error('插件链接无效'); }
      if (url.protocol !== 'https:') throw new Error('只允许打开 HTTPS 插件链接');
      await shell.openExternal(url.toString()); return { ok: true };
    });
    handle('openPluginFolder', async (input) => {
      const result = await marketplace.openPluginFolder(input);
      const error = await shell.openPath(result.absolutePath);
      return { ok: !error, error: error || undefined };
    });
  }

  async function chooseExistingProject() {
    const selection = await dialog.showOpenDialog(mainWindow, { title: '打开已有项目（使用同一真实目录）', defaultPath: workspaceRoot, properties: ['openDirectory'] });
    if (selection.canceled || !selection.filePaths[0]) return { ok: false, canceled: true };
    const nextRoot = path.resolve(selection.filePaths[0]);
    const stat = await fsp.stat(nextRoot);
    if (!stat.isDirectory()) throw new Error('选择的项目路径不是目录');
    const previousRoot = workspaceRoot;
    await store.save({ workspace: { ...store.getPreferences().workspace, path: nextRoot } });
    await workbench.resetWorkspace(previousRoot);
    await prepareWorkspace();
    await workbench.initializeSharedProject();
    await restartBackend();
    return { ok: true, path: workspaceRoot, shared: await workbench.getSharedSnapshot(true) };
  }

  async function prepareWorkspace() {
    const prefs = store.getPreferences();
    workspaceRoot = workspaceOverride || (prefs.workspace.path ? path.resolve(prefs.workspace.path) : path.join(app.getPath('documents'), 'DeepSeekHarnessWorkspace'));
    dshHome = path.join(workspaceRoot, '.dsh');
    await fsp.mkdir(workspaceRoot, { recursive: true });
    await fsp.mkdir(dshHome, { recursive: true });
    ensureModuleJunction();
    const d = prefs.deepseek;
    const models = [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }, { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }];
    const settingsPath = path.join(dshHome, 'settings.yaml');
    let settings = {};
    try {
      if (fs.existsSync(settingsPath)) {
        const current = YAML.parse(await fsp.readFile(settingsPath, 'utf8'));
        if (current !== undefined && current !== null && (typeof current !== 'object' || Array.isArray(current))) throw new Error('settings.yaml root must be a mapping');
        settings = current || {};
      }
    } catch (error) {
      logger.warn(`settings.yaml was not replaced because it could not be parsed: ${error.code || error.message}`);
      throw error;
    }
    const currentProvider = settings['llm-deepseek'] && typeof settings['llm-deepseek'] === 'object' ? settings['llm-deepseek'] : {};
    const currentDefault = settings['agent-default-model'] && typeof settings['agent-default-model'] === 'object' ? settings['agent-default-model'] : {};
    const currentPresets = settings['agent-presets'] && typeof settings['agent-presets'] === 'object' ? settings['agent-presets'] : {};
    const currentLoop = settings['agent-loop'] && typeof settings['agent-loop'] === 'object' ? settings['agent-loop'] : {};
    const level = getAgentLevel(prefs.agent?.level);
    settings['llm-deepseek'] = { ...currentProvider, baseURL: d.baseURL, models: Array.isArray(currentProvider.models) && currentProvider.models.length ? currentProvider.models : models };
    settings['agent-default-model'] = { ...currentDefault, provider: 'deepseek-official', model: d.model, reasoningEffort: level.reasoningEffort };
    // `maxParallelToolCalls` is an official agent-loop setting. The remaining
    // fields are Desktop policy metadata consumed by the budget guard and
    // personalized preset instructions; none pretend to be provider APIs.
    settings['agent-loop'] = { ...currentLoop, maxParallelToolCalls: level.maxParallelToolCalls };
    settings['desktop-agent'] = { schemaVersion: 1, level: level.id, maxSteps: level.maxSteps, verify: level.verify, repair: level.repair, budgetOverride: Number(prefs.agent?.budgetOverride) || 0 };
    settings['agent-presets'] = { ...currentPresets, default: 'deepseek-desktop' };
    const temp = `${settingsPath}.${process.pid}.tmp`;
    await fsp.writeFile(temp, YAML.stringify(settings), 'utf8');
    await fsp.rename(temp, settingsPath);
    // The home patch is intentionally tiny and contains no credentials. It
    // is the supported extension seam for the optional Vision tool package.
    const patchPath = path.join(dshHome, 'cordis.patch.yml');
    let patches = [];
    try {
      if (fs.existsSync(patchPath)) {
        const parsed = YAML.parse(await fsp.readFile(patchPath, 'utf8'));
        if (Array.isArray(parsed)) patches = parsed;
      }
    } catch (error) { logger.warn(`cordis.patch.yml was not replaced because it could not be parsed: ${error.code || error.message}`); throw error; }
    // The tool belongs to the agent plane, not the host plane. Remove a
    // legacy host insertion from an earlier build, then add it to the
    // desktop-derived agent preset below.
    patches = patches.filter((entry) => !(entry && typeof entry === 'object' && Array.isArray(entry.insert) && entry.insert.some((row) => row?.name === '@deepseek-harness/vision-plugin')));
    const patchTemp = `${patchPath}.${process.pid}.tmp`;
    await fsp.writeFile(patchTemp, '# Desktop extension seam; no API keys are stored here.\n' + YAML.stringify(patches), 'utf8');
    await fsp.rename(patchTemp, patchPath);
    await ensureDesktopPreset(prefs, level);
  }

  async function ensureDesktopPreset(prefs = store.getPreferences(), level = getAgentLevel(prefs.agent?.level)) {
    const shipped = path.join(runtimeNodeModules(), '@deepseek-ai', 'dsh', 'config', 'agent-presets', 'standard');
    const destination = path.join(dshHome, '.agent-presets', 'deepseek-desktop');
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    const sourceAgent = path.join(shipped, 'agent.cordis.yml');
    const targetAgent = path.join(destination, 'agent.cordis.yml');
    if (!fs.existsSync(targetAgent)) {
      await fsp.cp(shipped, destination, { recursive: true });
    }
    let text = await fsp.readFile(targetAgent, 'utf8');
    if (!text.includes("@deepseek-harness/vision-plugin")) {
      text += "\n# Desktop extension: independent Vision bridge (GLM only).\n- id: vision-analyze\n  name: '@deepseek-harness/vision-plugin'\n";
    }
    if (!text.includes("@deepseek-harness/browser-plugin")) {
      text += "\n# Desktop extension: optional isolated Browser automation (permission-gated).\n- id: browser-agent\n  name: '@deepseek-harness/browser-plugin'\n";
    }
    const marker = '# Desktop personalization: generated by DeepSeek Harness Desktop';
    const clean = text.replace(new RegExp(`\\n${marker}[\\s\\S]*?(?=\\n- id:|$)`), '');
    const p = prefs.personalization || {};
    const instructions = [p.globalInstructions, p.workspaceInstructions].filter(Boolean).join('\n').trim().slice(0, 24000);
    const lines = [marker, `# Agent level: ${level.id}; provider effort: ${level.reasoningEffort}; max steps: ${level.maxSteps}.`, `# Desktop policy: verify=${level.verify}; repair=${level.repair}.`];
    if (instructions) {
      lines.push('# User instructions below are subordinate to project AGENTS.md rules.');
      for (const line of instructions.split(/\r?\n/)) lines.push(`# ${line.replace(/[\r\n]/g, ' ').slice(0, 500)}`);
    }
    text = `${clean.trimEnd()}\n${lines.join('\n')}\n`;
    await fsp.writeFile(targetAgent, text, 'utf8');
  }

  function ensureModuleJunction() {
    const moduleRoot = path.join(dshHome, 'node_modules');
    const appModules = runtimeNodeModules();
    try {
      let current;
      try { current = fs.realpathSync(moduleRoot); } catch { current = undefined; }
      if (current && path.resolve(current) === path.resolve(appModules)) return;
      if (current) {
        // A junction from an earlier development/installed build can point at
        // a stale dependency tree. Only remove a link, never a user directory.
        const stat = fs.lstatSync(moduleRoot);
        if (!stat.isSymbolicLink()) {
          logger.warn('workspace node_modules exists as a real directory; leaving it untouched');
          return;
        }
        fs.unlinkSync(moduleRoot);
      } else {
        // realpath fails for a broken junction; lstat still lets us replace
        // that link without touching a normal directory.
        try {
          if (fs.lstatSync(moduleRoot).isSymbolicLink()) fs.unlinkSync(moduleRoot);
        } catch { /* path does not exist */ }
      }
      fs.symlinkSync(appModules, moduleRoot, 'junction');
    } catch (error) {
      logger.warn(`workspace module junction unavailable: ${error.code || error.message}`);
      // A read-only installation can still use the official CLI without the
      // optional plugin; leave the diagnostic to the loader rather than copy
      // a second mutable dependency tree.
    }
  }

  async function startBackend() {
    if (backend) await stopBackend();
    const prefs = store.getPreferences();
    const configuredPort = Number(prefs.advanced?.harnessPort) || 0;
    backendPort = prefs.advanced?.dynamicPort === false && configuredPort > 0 ? configuredPort : await freePort();
    const dshBin = path.join(runtimeNodeModules(), '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    if (!fs.existsSync(dshBin)) throw new Error(`official dsh binary not found: ${dshBin}`);
    const apiKey = store.getSecret('deepseekApiKey');
    const permissions = prefs.permissions || {};
    const browserEnabled = Boolean(prefs.browser?.enabled && permissions.browser);
    const browserDataDir = path.join(app.getPath('userData'), 'browser', 'profile');
    await fsp.mkdir(browserDataDir, { recursive: true });
    const env = {
      ...process.env,
      DSH_HOME: dshHome,
      DSH_TELEMETRY_DISABLED: '1',
      DSH_DESKTOP: '1',
      DSH_PERMISSION_MODE: permissions.workspaceWrite === false ? 'read-only' : 'workspace-write',
      DSH_DESKTOP_AGENT_LEVEL: getAgentLevel(prefs.agent?.level).id,
      DSH_DESKTOP_AGENT_MAX_STEPS: String(getAgentLevel(prefs.agent?.level).maxSteps + (Number(prefs.agent?.budgetOverride) || 0)),
      DSH_DESKTOP_VERIFY: getAgentLevel(prefs.agent?.level).verify ? '1' : '0',
      DSH_DESKTOP_REPAIR: getAgentLevel(prefs.agent?.level).repair ? '1' : '0',
      DEEPSEEK_BASE_URL: prefs.deepseek.baseURL,
      ...(prefs.vision.enabled && store.getSecret('visionApiKey') ? { VISION_API_KEY: store.getSecret('visionApiKey') } : {}),
      ...(prefs.vision.baseURL ? { VISION_BASE_URL: prefs.vision.baseURL } : {}),
      ...(prefs.vision.model ? { VISION_MODEL: prefs.vision.model } : {}),
      ...(prefs.vision.provider ? { VISION_PROVIDER: prefs.vision.provider } : {}),
      BROWSER_ENABLED: browserEnabled ? '1' : '0',
      BROWSER_PERMISSION: browserEnabled ? '1' : '0',
      BROWSER_HEADLESS: prefs.browser?.headless ? '1' : '0',
      BROWSER_DATA_DIR: browserDataDir,
      BROWSER_EXECUTABLE: prefs.browser?.executable || '',
      BROWSER_DOWNLOAD_DIR: prefs.browser?.downloadDir || prefs.general?.downloadDir || path.join(workspaceRoot, '.harness-desktop', 'browser', 'downloads'),
      BROWSER_ALLOWED_DOMAINS: (prefs.browser?.allowedDomains || []).join(','),
      BROWSER_BLOCKED_DOMAINS: (prefs.browser?.blockedDomains || []).join(','),
      BROWSER_CONFIRM_DOWNLOAD: prefs.browser?.confirmDownloads === false ? '0' : '1',
      BROWSER_CONFIRM_UPLOAD: prefs.browser?.confirmUploads === false ? '0' : '1',
      ...(apiKey ? { DEEPSEEK_API_KEY: apiKey } : {}),
    };
    const args = [dshBin, 'web', '--host', '127.0.0.1', '--port', String(backendPort)];
    const systemNode = findSystemNode();
    let child;
    if (systemNode) {
      child = spawn(systemNode, args, { cwd: workspaceRoot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } else {
      child = spawn(process.execPath, [...args, '--expose-internals'], { cwd: workspaceRoot, env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    }
    attachBackendLogging(child);
    backend = child;
    const ready = await waitForReady(child, backendPort, prefs.advanced?.startupTimeoutMs);
    if (!ready) {
      await stopBackend();
      if (!systemNode) throw new Error('Electron Node runner failed and no system Node.js executable was found');
      logger.warn('dsh did not stay ready; retrying with system Node.js');
      child = spawn(systemNode, args, { cwd: workspaceRoot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      attachBackendLogging(child);
      backend = child;
      if (!await waitForReady(child, backendPort, prefs.advanced?.startupTimeoutMs)) { await stopBackend(); throw new Error('dsh Web did not become ready on the selected loopback port'); }
    }
  }

  function attachBackendLogging(child) {
    child.stdout?.on('data', (chunk) => chunk.toString().split(/\r?\n/).filter(Boolean).forEach((line) => logger.info(`dsh stdout: ${redact(line)}`)));
    child.stderr?.on('data', (chunk) => chunk.toString().split(/\r?\n/).filter(Boolean).forEach((line) => logger.warn(`dsh stderr: ${redact(line)}`)));
    child.on('error', (error) => logger.error(`dsh process error: ${error.code || error.message}`));
    child.on('exit', (code, signal) => { logger.info(`dsh process exited (${code ?? 'null'}/${signal ?? 'none'})`); if (backend === child && !stopping) backendPort = undefined; });
  }

  async function waitForReady(child, port, timeoutMs = 60000) {
    const started = Date.now();
    while (Date.now() - started < (Number(timeoutMs) || 60000)) {
      if (child.exitCode !== null) return false;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
        if (response.status >= 200 && response.status < 500) {
          await delay(1500);
          return child.exitCode === null;
        }
      } catch { /* server is still composing */ }
      await delay(250);
    }
    return false;
  }

  async function restartBackend() {
    try { await startBackend(); } catch (error) { logger.error(`Harness restart failed: ${error.code || error.message}`); await showError(error); throw error; }
    if (harnessView && !harnessView.webContents.isDestroyed()) await loadHarnessView();
  }

  async function stopBackend() {
    const child = backend;
    backend = undefined;
    if (!child || child.exitCode !== null) return;
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      child.once('exit', finish);
      try { child.kill('SIGTERM'); } catch {}
      const gracefulTimer = setTimeout(() => {
        logger.warn(`dsh graceful stop timed out; forcing process tree ${child.pid}`);
        if (process.platform === 'win32') {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
          killer.once('exit', finish); killer.once('error', finish);
        } else { try { child.kill('SIGKILL'); } catch {} finish(); }
      }, 5000);
      child.once('exit', () => { clearTimeout(gracefulTimer); logger.info('dsh backend stopped gracefully'); });
    });
  }

  function createMainWindow() {
    mainWindow = new BrowserWindow({ width: 1480, height: 940, minWidth: 1040, minHeight: 680, title: 'DeepSeek Harness Workbench', backgroundColor: '#080b12', show: false, autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'workbench-preload.cjs') } });
    mainWindow.setMenuBarVisibility(false);
    harnessView = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    mainWindow.contentView.addChildView(harnessView);
    const guard = ({ url }) => {
      if (/^https?:/i.test(url) && !isHarnessUrl(url)) shell.openExternal(url);
      return { action: 'deny' };
    };
    mainWindow.webContents.setWindowOpenHandler(guard);
    harnessView.webContents.setWindowOpenHandler(guard);
    harnessView.webContents.on('will-navigate', (event, url) => {
      if (!isHarnessUrl(url)) { event.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
    });
    mainWindow.on('resize', updateHarnessBounds);
    mainWindow.on('closed', () => {
      if (harnessView && !harnessView.webContents.isDestroyed()) harnessView.webContents.close();
      harnessView = undefined;
      mainWindow = undefined;
    });
    Promise.all([mainWindow.loadFile(path.join(__dirname, 'workbench.html')), loadHarnessView()])
      .then(() => { updateHarnessBounds(); mainWindow.show(); })
      .catch((error) => logger.error(`UI load failed: ${error.code || error.message}`));
  }

  function updateHarnessBounds() {
    if (!mainWindow || mainWindow.isDestroyed() || !harnessView || harnessView.webContents.isDestroyed()) return;
    const [width, height] = mainWindow.getContentSize();
    const top = 52;
    const rail = workbenchLayout.railOpen ? workbenchLayout.railWidth : 0;
    const dock = workbenchLayout.dockOpen ? workbenchLayout.dockHeight : 0;
    harnessView.setBounds({ x: 0, y: top, width: Math.max(360, width - rail), height: Math.max(260, height - top - dock) });
  }

  function toggleWorkbenchPart(part) {
    workbenchLayout = { ...workbenchLayout, [part]: !workbenchLayout[part] };
    updateHarnessBounds();
    mainWindow?.webContents.send('workbench:layout', workbenchLayout);
  }

  function sanitizeWorkbenchLayout(input) {
    return {
      railOpen: input?.railOpen !== false,
      dockOpen: Boolean(input?.dockOpen),
      railWidth: Math.min(420, Math.max(296, Number(input?.railWidth) || 336)),
      dockHeight: Math.min(360, Math.max(190, Number(input?.dockHeight) || 250)),
    };
  }

  function isHarnessUrl(url) {
    try { const parsed = new URL(url); return parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && parsed.port === String(backendPort); }
    catch { return false; }
  }

  function loadHarnessView() {
    if (!harnessView || harnessView.webContents.isDestroyed()) return Promise.resolve();
    return harnessView.webContents.loadURL(`http://127.0.0.1:${backendPort}/`);
  }

  function openSettingsWindow() {
    if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.show(); settingsWindow.focus(); return; }
    settingsWindow = new BrowserWindow({ width: 820, height: 760, minWidth: 620, minHeight: 620, title: 'DeepSeek Harness 设置', parent: mainWindow, modal: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'settings-preload.cjs') } });
    settingsWindow.on('closed', () => { settingsWindow = undefined; });
    settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  }

  function closeSettingsWindow() { if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close(); settingsWindow = undefined; }

  function openUsageWindow() {
    if (usageWindow && !usageWindow.isDestroyed()) { usageWindow.show(); usageWindow.focus(); return; }
    usageWindow = new BrowserWindow({ width: 980, height: 720, minWidth: 720, minHeight: 560, title: 'Usage & Billing', parent: mainWindow, modal: false, backgroundColor: '#0a0e15', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'usage-preload.cjs') } });
    usageWindow.setMenuBarVisibility(false);
    usageWindow.on('closed', () => { usageWindow = undefined; });
    usageWindow.loadFile(path.join(__dirname, 'usage.html'));
  }

  function closeUsageWindow() { if (usageWindow && !usageWindow.isDestroyed()) usageWindow.close(); usageWindow = undefined; }

  function decorateSettings(publicSettings) {
    const value = publicSettings || store.publicSettings();
    return { ...value, dataPaths: { userData: app.getPath('userData'), logs: logger?.file || '', usage: appData?.file || '', workspace: workspaceRoot || '', cache: path.join(app.getPath('userData'), 'cache') }, app: { desktopVersion: app.getVersion(), electron: process.versions.electron, node: process.versions.node, harness: '0.1.0-rc.6', license: 'MIT (Desktop) + upstream notices' } };
  }

  function applyLoginItemSetting() {
    try { app.setLoginItemSettings({ openAtLogin: Boolean(store.getPreferences().general?.startOnBoot), args: ['--launched-at-login'] }); } catch (error) { logger?.warn(`login item setting unavailable: ${error.code || error.message}`); }
  }

  function setupTray() {
    const prefs = store.getPreferences();
    if (!prefs.general?.closeToTray || tray) return;
    const icon = fs.existsSync(path.join(__dirname, '..', 'build', 'icon.png')) ? nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')) : nativeImage.createEmpty();
    tray = new Tray(icon);
    tray.setToolTip('DeepSeek Harness Desktop');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: '显示工作台', click: () => { mainWindow?.show(); mainWindow?.focus(); } }, { label: '设置', click: () => openSettingsWindow() }, { type: 'separator' }, { label: '退出', click: () => { stopping = false; app.quit(); } }]));
    tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.on('close', (event) => { if (!stopping && store.getPreferences().general?.closeToTray) { event.preventDefault(); mainWindow.hide(); } });
  }

  function openMarketplaceWindow() {
    if (marketplaceWindow && !marketplaceWindow.isDestroyed()) { marketplaceWindow.show(); marketplaceWindow.focus(); return; }
    marketplaceWindow = new BrowserWindow({ width: 940, height: 760, minWidth: 700, minHeight: 560, title: 'Harness 插件', parent: mainWindow, modal: false, backgroundColor: '#090d16', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'marketplace-preload.cjs') } });
    marketplaceWindow.setMenuBarVisibility(false);
    marketplaceWindow.on('closed', () => { marketplaceWindow = undefined; });
    marketplaceWindow.loadFile(path.join(__dirname, 'marketplace.html'));
  }

  async function testDeepSeek() {
    const prefs = store.getPreferences();
    const key = store.getSecret('deepseekApiKey');
    if (!key) return { ok: false, status: 'Awaiting API Key', code: 'MISSING_CREDENTIAL' };
    const base = prefs.deepseek.baseURL.replace(/\/$/, ''); const model = prefs.deepseek.model;
    try {
      const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
      const modelsResponse = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(30000) });
      const modelsBody = await modelsResponse.json().catch(() => ({}));
      if (!modelsResponse.ok) throw Object.assign(new Error(`DeepSeek /models HTTP ${modelsResponse.status}`), { code: `HTTP_${modelsResponse.status}` });
      const ids = Array.isArray(modelsBody.data) ? modelsBody.data.map((item) => item?.id).filter(Boolean) : [];
      if (ids.length && !ids.includes(model)) return { ok: false, status: 'Model ID not advertised by /models', code: 'MODEL_NOT_FOUND' };
      const chatResponse = await fetch(`${base}/chat/completions`, { method: 'POST', headers, signal: AbortSignal.timeout(60000), body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 8, stream: false }) });
      const chatBody = await chatResponse.json().catch(() => ({}));
      if (!chatResponse.ok) throw Object.assign(new Error(`DeepSeek chat HTTP ${chatResponse.status}`), { code: `HTTP_${chatResponse.status}` });
      const text = chatBody?.choices?.[0]?.message?.content;
      if (chatBody?.usage) await appData.recordUsage({ ...chatBody.usage, provider: 'deepseek-official', model, workspace: workspaceRoot, source: 'connection-test', requestAt: new Date().toISOString() });
      return { ok: true, status: 'DeepSeek Ready', model, preview: typeof text === 'string' ? text.slice(0, 80) : 'response received', advertisedModels: ids.length };
    } catch (error) { logger.warn(`DeepSeek connection test failed: ${error.code || error.message}`); return { ok: false, status: 'DeepSeek Error', code: error.code || 'REQUEST_FAILED', error: safeError(error) }; }
  }

  async function showStartupFailure(error) {
    const choice = await dialog.showMessageBox({ type: 'error', title: 'DeepSeek Harness 启动失败', message: '官方 dsh Web 后端未能启动。', detail: `${error.code || error.message}\n\n日志：${logger?.file || '未知'}`, buttons: ['打开设置', '退出'], defaultId: 0 });
    if (choice.response === 0) openSettingsWindow(); else app.quit();
  }
  async function showError(error) { await dialog.showMessageBox({ type: 'error', title: 'DeepSeek Harness', message: error?.message || String(error), detail: `日志：${logger?.file || '未知'}` }); }
  function findSystemNode() {
    const candidates = [process.env.DSH_NODE, 'C:\\Program Files\\nodejs\\node.exe', 'C:\\Program Files (x86)\\nodejs\\node.exe'];
    const direct = candidates.find((candidate) => candidate && fs.existsSync(candidate));
    if (direct) return direct;
    try { const found = require('node:child_process').execFileSync('where.exe', ['node.exe'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).find(Boolean); return found || undefined; } catch { return undefined; }
  }
  function runtimeNodeModules() {
    // The production-only staging tree is copied to resources/dsh-runtime by
    // electron-builder. It keeps all dsh peer dependencies available to the
    // system Node process without relying on app.asar resolution. The
    // unpacked dependency tree is retained as a fallback for older builds.
    const staged = path.join(process.resourcesPath, 'dsh-runtime', 'node_modules');
    if (app.isPackaged && fs.existsSync(staged)) return staged;
    const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules');
    if (app.isPackaged && fs.existsSync(unpacked)) return unpacked;
    return path.join(app.getAppPath(), 'node_modules');
  }
  function safeError(error) { return `${error?.code || 'REQUEST_FAILED'}: ${String(error?.message || 'request failed').replace(/sk-[A-Za-z0-9._-]+/g, 'sk-[REDACTED]')}`; }
  function sanitizeSettingsInput(input) {
    const value = input && typeof input === 'object' ? input : {};
    const output = {};
    for (const section of ['deepseek', 'vision', 'workspace', 'debug', 'general', 'appearance', 'personalization', 'agent', 'permissions', 'browser', 'advanced']) {
      if (value[section] && typeof value[section] === 'object') output[section] = value[section];
    }
    if (typeof value.deepseekApiKey === 'string') output.deepseekApiKey = value.deepseekApiKey;
    if (typeof value.visionApiKey === 'string') output.visionApiKey = value.visionApiKey;
    return output;
  }
  function freePort() { return new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); }); }
  function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  function readSecretStdin() {
    let value;
    try { value = fs.readFileSync(0, 'utf8'); } catch { throw new Error('credential missing'); }
    const key = String(value).trim();
    if (!key || key.length > 4096 || /[\r\n]/.test(key)) throw new Error('credential missing');
    return key;
  }
}
