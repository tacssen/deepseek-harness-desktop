const { app, BrowserWindow, WebContentsView, Menu, ipcMain, safeStorage, dialog, shell } = require('electron');
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

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow;
  let harnessView;
  let settingsWindow;
  let marketplaceWindow;
  let backend;
  let backendPort;
  let stopping = false;
  let logger;
  let store;
  let vision;
  let workbench;
  let marketplace;
  let workspaceRoot;
  let dshHome;
  let workbenchLayout = { railOpen: true, dockOpen: false, railWidth: 336, dockHeight: 250 };
  const importDeepSeekKey = process.argv.includes('--import-deepseek-key-stdin');
  const importVisionKey = process.argv.includes('--import-vision-key-stdin');
  const testVisionOnce = process.argv.includes('--test-vision-once');
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
    vision = new VisionBridge(app, store, logger);
    if (testVisionOnce) {
      const result = await vision.test(store.publicSettings().vision);
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
    workbench = new WorkbenchService({ app, logger, getPort: () => backendPort, getWorkspace: () => workspaceRoot });
    marketplace = new MarketplaceService({ app, logger, getWorkspace: () => workspaceRoot, getDshHome: () => dshHome, verifiedAllowlist: {}, progress: (value) => marketplaceWindow?.webContents.send('marketplace:progress', value) });
    registerWorkbenchIpc();
    registerMarketplaceIpc();
    createMenu();
    try {
      await startBackend();
      createMainWindow();
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
    closeSettingsWindow();
    Promise.allSettled([workbench?.close(), stopBackend()]).finally(() => { app.exit(0); });
  });

  ipcMain.handle('get-status', () => ({ backend: Boolean(backend && backend.exitCode === null), port: backendPort || null, settings: store.publicSettings(), vision: vision.status() }));
  ipcMain.handle('open-settings', () => { openSettingsWindow(); return true; });
  ipcMain.handle('settings-load', () => store.publicSettings());
  ipcMain.handle('settings-save', async (_event, input) => {
    const publicSettings = await store.save(sanitizeSettingsInput(input));
    await prepareWorkspace();
    await restartBackend();
    return publicSettings;
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
    settings['llm-deepseek'] = { ...currentProvider, baseURL: d.baseURL, models: Array.isArray(currentProvider.models) && currentProvider.models.length ? currentProvider.models : models };
    settings['agent-default-model'] = { ...currentDefault, provider: 'deepseek-official', model: d.model };
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
    await ensureDesktopPreset();
  }

  async function ensureDesktopPreset() {
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
      await fsp.writeFile(targetAgent, text, 'utf8');
    }
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
    backendPort = await freePort();
    const dshBin = path.join(runtimeNodeModules(), '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    if (!fs.existsSync(dshBin)) throw new Error(`official dsh binary not found: ${dshBin}`);
    const prefs = store.getPreferences();
    const apiKey = store.getSecret('deepseekApiKey');
    const env = {
      ...process.env,
      DSH_HOME: dshHome,
      DSH_TELEMETRY_DISABLED: '1',
      DSH_DESKTOP: '1',
      DSH_PERMISSION_MODE: prefs.workspace.allowShell ? 'workspace-write' : 'read-only',
      DEEPSEEK_BASE_URL: prefs.deepseek.baseURL,
      ...(prefs.vision.enabled && store.getSecret('visionApiKey') ? { VISION_API_KEY: store.getSecret('visionApiKey') } : {}),
      ...(prefs.vision.baseURL ? { VISION_BASE_URL: prefs.vision.baseURL } : {}),
      ...(prefs.vision.model ? { VISION_MODEL: prefs.vision.model } : {}),
      ...(prefs.vision.provider ? { VISION_PROVIDER: prefs.vision.provider } : {}),
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
    const ready = await waitForReady(child, backendPort);
    if (!ready) {
      await stopBackend();
      if (!systemNode) throw new Error('Electron Node runner failed and no system Node.js executable was found');
      logger.warn('dsh did not stay ready; retrying with system Node.js');
      child = spawn(systemNode, args, { cwd: workspaceRoot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      attachBackendLogging(child);
      backend = child;
      if (!await waitForReady(child, backendPort)) { await stopBackend(); throw new Error('dsh Web did not become ready on the selected loopback port'); }
    }
  }

  function attachBackendLogging(child) {
    child.stdout?.on('data', (chunk) => chunk.toString().split(/\r?\n/).filter(Boolean).forEach((line) => logger.info(`dsh stdout: ${redact(line)}`)));
    child.stderr?.on('data', (chunk) => chunk.toString().split(/\r?\n/).filter(Boolean).forEach((line) => logger.warn(`dsh stderr: ${redact(line)}`)));
    child.on('error', (error) => logger.error(`dsh process error: ${error.code || error.message}`));
    child.on('exit', (code, signal) => { logger.info(`dsh process exited (${code ?? 'null'}/${signal ?? 'none'})`); if (backend === child && !stopping) backendPort = undefined; });
  }

  async function waitForReady(child, port) {
    const started = Date.now();
    while (Date.now() - started < 60000) {
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
    const output = { deepseek: value.deepseek, vision: value.vision, workspace: value.workspace, debug: value.debug };
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
