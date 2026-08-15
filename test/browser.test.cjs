const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

test('real Browser smoke: open, read, click, type and screenshot with isolated profile', async (t) => {
  const candidates = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'];
  let executablePath;
  for (const candidate of candidates) { try { await fs.access(candidate); executablePath = candidate; break; } catch {} }
  if (!executablePath) { t.skip('No Edge/Chrome executable found'); return; }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-v04-browser-'));
  const context = await chromium.launchPersistentContext(path.join(root, 'profile'), { headless: true, executablePath, acceptDownloads: true, viewport: { width: 900, height: 600 }, downloadsPath: path.join(root, 'downloads') });
  t.after(async () => { await context.close(); await fs.rm(root, { recursive: true, force: true }); });
  const page = await context.newPage();
  await page.setContent('<!doctype html><title>Smoke</title><button id="go">Go</button><input id="name"><p id="out">ready</p><script>document.getElementById("go").onclick=()=>document.getElementById("out").textContent=document.getElementById("name").value||"clicked"</script>');
  assert.equal(await page.title(), 'Smoke');
  assert.match(await page.locator('body').innerText(), /Go\s+ready/);
  await page.locator('#name').fill('browser-ok'); await page.locator('#go').click();
  assert.match(await page.locator('#out').innerText(), /browser-ok/);
  const image = path.join(root, 'smoke.png'); await page.screenshot({ path: image }); assert.ok((await fs.stat(image)).size > 100);
});
