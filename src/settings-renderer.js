(() => {
  const $ = (id) => document.getElementById(id);
  const message = (text, kind = '') => { $('message').textContent = text; $('message').className = kind; };
  const status = (id, text, kind = '') => { const node = $(id); node.textContent = text; node.className = `status ${kind}`; };
  function fill(value) {
    const d = value.deepseek || {}; const v = value.vision || {}; const w = value.workspace || {}; const debug = value.debug || {};
    $('deepseekBaseURL').value = d.baseURL || 'https://api.deepseek.com';
    $('deepseekModel').value = d.model || 'deepseek-v4-flash';
    $('visionEnabled').checked = Boolean(v.enabled);
    $('visionBaseURL').value = v.baseURL || 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
    $('visionModel').value = v.model || 'glm-4.6v-flash';
    $('workspacePath').value = w.path || '';
    $('allowShell').checked = w.allowShell !== false;
    $('debugEnabled').checked = Boolean(debug.enabled);
    $('deepseekKeyState').textContent = d.apiKeyConfigured ? `Configured (${d.apiKeyMasked}); leave blank to keep` : 'Not configured';
    $('visionKeyState').textContent = v.apiKeyConfigured ? `Configured (${v.apiKeyMasked})` : (v.enabled ? 'Awaiting API Key' : 'Vision Disabled');
  }
  async function load() { try { fill(await window.settings.load()); } catch (error) { message(error.message, 'danger'); } }
  $('save').addEventListener('click', async () => {
    const value = {
      deepseek: { baseURL: $('deepseekBaseURL').value.trim(), model: $('deepseekModel').value },
      vision: { enabled: $('visionEnabled').checked, baseURL: $('visionBaseURL').value.trim(), model: $('visionModel').value.trim() },
      workspace: { path: $('workspacePath').value.trim(), allowShell: $('allowShell').checked },
      debug: { enabled: $('debugEnabled').checked },
    };
    if ($('deepseekApiKey').value) value.deepseekApiKey = $('deepseekApiKey').value;
    if ($('visionApiKey').value) value.visionApiKey = $('visionApiKey').value;
    $('save').disabled = true; message('Saving (keys are never displayed)...');
    try { fill(await window.settings.save(value)); $('deepseekApiKey').value = ''; $('visionApiKey').value = ''; message('Saved. Harness backend is restarting.', 'good'); }
    catch (error) { message(error.message, 'danger'); } finally { $('save').disabled = false; }
  });
  $('clear').addEventListener('click', async () => {
    if (!confirm('Clear both API keys?')) return;
    try { fill(await window.settings.clearSecrets()); message('Both API keys were removed from DPAPI storage.', 'good'); }
    catch (error) { message(error.message, 'danger'); }
  });
  $('testDeepSeek').addEventListener('click', async () => {
    status('deepseekStatus', 'Calling /models then a minimal chat...');
    try { const result = await window.settings.testDeepSeek(); status('deepseekStatus', result.ok ? `${result.status} - ${result.model}` : `${result.code || 'Failed'}: ${result.error || result.status}`, result.ok ? 'good' : 'bad'); }
    catch (error) { status('deepseekStatus', error.message, 'bad'); }
  });
  $('testVision').addEventListener('click', async () => {
    status('visionStatus', 'Calling Vision provider...');
    try { const result = await window.settings.testVision(); status('visionStatus', result.ok ? `${result.status} - ${result.model}` : `${result.code || 'Failed'}: ${result.error || result.status}`, result.ok ? 'good' : (result.code === 'MISSING_CREDENTIAL' ? 'warn' : 'bad')); }
    catch (error) { status('visionStatus', error.message, 'bad'); }
  });
  $('openLogs').addEventListener('click', async () => {
    try {
      const result = await window.settings.openLogs();
      message(result.ok ? 'Opened the log folder.' : `Could not open logs: ${result.error || 'unknown error'}`, result.ok ? 'good' : 'danger');
    } catch (error) { message(error.message, 'danger'); }
  });
  $('clearVisionCache').addEventListener('click', async () => {
    if (!confirm('Clear cached Vision responses?')) return;
    try {
      const result = await window.settings.clearVisionCache();
      message(result.ok ? 'Vision cache cleared.' : `Could not clear cache: ${result.error || 'unknown error'}`, result.ok ? 'good' : 'danger');
    } catch (error) { message(error.message, 'danger'); }
  });
  $('close').addEventListener('click', () => window.settings.close());
  load();
})();
