import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { chromium } from 'playwright-core'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'browser-plugin'
export const inject = ['tools']

const enabled = process.env.BROWSER_ENABLED === '1' && process.env.BROWSER_PERMISSION === '1'
const root = path.resolve(process.cwd())
const dataDir = path.resolve(process.env.BROWSER_DATA_DIR || path.join(root, '.harness-desktop', 'browser', 'profile'))
const screenshotDir = path.join(root, '.harness-desktop', 'browser', 'screenshots')
const allowed = parseDomains(process.env.BROWSER_ALLOWED_DOMAINS)
const blocked = parseDomains(process.env.BROWSER_BLOCKED_DOMAINS)
let contextPromise
const pages = new Map()

function parseDomains(value) { return String(value || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean).slice(0, 100) }
function executablePath() {
  const configured = process.env.BROWSER_EXECUTABLE
  if (configured) return configured
  if (process.platform === 'win32') {
    return ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((candidate) => fsSync.existsSync(candidate))
  }
  return undefined
}
function hostAllowed(rawUrl) {
  let url
  try { url = new URL(rawUrl) } catch { return false }
  if (!['http:', 'https:', 'file:'].includes(url.protocol)) return false
  if (url.protocol === 'file:') return false
  const host = url.hostname.toLowerCase()
  if (blocked.some((item) => host === item || host.endsWith(`.${item}`))) return false
  if (allowed.length && !allowed.some((item) => host === item || host.endsWith(`.${item}`))) return false
  return true
}
async function getContext() {
  if (!enabled) throw new Error('Browser 未启用；请在 Settings → Permissions → Browser 中显式开启。')
  if (!contextPromise) {
    await fs.mkdir(dataDir, { recursive: true })
    contextPromise = chromium.launchPersistentContext(dataDir, { headless: process.env.BROWSER_HEADLESS !== '0', executablePath: executablePath(), acceptDownloads: true, viewport: { width: 1440, height: 900 }, downloadsPath: path.join(root, '.harness-desktop', 'browser', 'downloads') })
    contextPromise.catch(() => { contextPromise = undefined })
  }
  return contextPromise
}
async function getPage(context, index = 0) {
  const current = context.pages()[Number(index) || 0]
  if (current) return current
  const page = await context.newPage()
  return page
}
async function ensureUrl(page, url) {
  if (!hostAllowed(url)) throw new Error('Browser 目标域名未通过允许列表或 URL 策略。')
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
}
function resultSchema() { return { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, status: { type: 'string' }, url: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' }, path: { type: 'string' }, tabs: { type: 'array' }, code: { type: 'string' } } } }
function out(value) { return { ok: true, ...value } }

export function apply(ctx) {
  if (!enabled) return
  ctx.tools.register(defineTool({
    name: 'browser',
    description: 'Use the isolated, visible-or-headless Playwright browser. Browser is separate from web search. Navigate, inspect, click and type only within the configured domain policy. Uploads/downloads require explicit Desktop settings confirmation.',
    parameters: {
      action: { type: 'string', description: 'open, new_tab, close_tab, switch_tab, back, forward, reload, click, type, scroll, read, screenshot, upload, download, wait' },
      url: { type: 'string', description: 'HTTP(S) URL for open/new_tab.' },
      selector: { type: 'string', description: 'CSS selector for click/type/upload/download.' },
      text: { type: 'string', description: 'Text for type or wait.' },
      index: { type: 'number', description: 'Tab index.' },
      path: { type: 'string', description: 'Workspace-relative file path for upload.' },
      direction: { type: 'string', description: 'scroll direction: up/down/top/bottom' },
      pixels: { type: 'number', description: 'Scroll distance.' },
    },
    output: { schema: resultSchema(), render: (_args, value) => [{ type: 'text', text: value.ok ? `${value.status || 'Browser OK'}${value.url ? ` — ${value.url}` : ''}${value.text ? `\n${value.text.slice(0, 2000)}` : ''}` : `${value.status || 'Browser Error'}${value.code ? ` (${value.code})` : ''}` }] },
    async execute(args, exec) {
      if (!enabled) return { ok: false, status: 'Browser Disabled', code: 'DISABLED' }
      if (exec.signal.aborted) return { ok: false, status: 'Cancelled', code: 'ABORTED' }
      const context = await getContext()
      let page = await getPage(context, args.index)
      const action = String(args.action || '').toLowerCase()
      if (action === 'open') { await ensureUrl(page, String(args.url || '')); return out({ status: '已打开页面', url: page.url(), title: await page.title() }) }
      if (action === 'new_tab') { page = await context.newPage(); if (args.url) await ensureUrl(page, String(args.url)); return out({ status: '已创建新标签页', url: page.url(), title: await page.title(), tabs: context.pages().map((item) => item.url()) }) }
      if (action === 'close_tab') { await page.close(); return out({ status: '已关闭标签页', tabs: context.pages().map((item) => item.url()) }) }
      if (action === 'switch_tab') { page = await getPage(context, Number(args.index) || 0); await page.bringToFront(); return out({ status: '已切换标签页', url: page.url(), title: await page.title() }) }
      if (action === 'back') { await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}); return out({ status: '已后退', url: page.url(), title: await page.title() }) }
      if (action === 'forward') { await page.goForward({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}); return out({ status: '已前进', url: page.url(), title: await page.title() }) }
      if (action === 'reload') { await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }); return out({ status: '已刷新', url: page.url(), title: await page.title() }) }
      if (action === 'click') { if (!args.selector) throw new Error('click 需要 selector'); await page.locator(String(args.selector)).first().click({ timeout: 15000 }); return out({ status: '已点击', url: page.url() }) }
      if (action === 'type') { if (!args.selector) throw new Error('type 需要 selector'); await page.locator(String(args.selector)).first().fill(String(args.text || ''), { timeout: 15000 }); return out({ status: '已输入文本', url: page.url() }) }
      if (action === 'scroll') { const direction = String(args.direction || 'down'); if (direction === 'top') await page.evaluate(() => window.scrollTo(0, 0)); else if (direction === 'bottom') await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); else await page.mouse.wheel(0, (Number(args.pixels) || 700) * (direction === 'up' ? -1 : 1)); return out({ status: '已滚动', url: page.url() }) }
      if (action === 'read') { const text = await page.locator('body').innerText({ timeout: 15000 }); return out({ status: '已读取页面', url: page.url(), title: await page.title(), text: text.slice(0, 12000) }) }
      if (action === 'screenshot') { await fs.mkdir(screenshotDir, { recursive: true }); const file = path.join(screenshotDir, `browser-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.png`); await page.screenshot({ path: file, type: 'png' }); return out({ status: '已保存截图', path: path.relative(root, file), url: page.url() }) }
      if (action === 'upload') { if (process.env.BROWSER_CONFIRM_UPLOAD !== '1') return { ok: false, status: '上传需要确认', code: 'UPLOAD_CONFIRMATION_REQUIRED' }; if (!args.selector || !args.path) throw new Error('upload 需要 selector 和 workspace-relative path'); const file = path.resolve(root, String(args.path)); if (!file.startsWith(`${root}${path.sep}`)) throw new Error('上传路径必须位于 Workspace'); await page.locator(String(args.selector)).setInputFiles(file, { timeout: 15000 }); return out({ status: '已上传文件', url: page.url() }) }
      if (action === 'download') { if (process.env.BROWSER_CONFIRM_DOWNLOAD !== '1') return { ok: false, status: '下载需要确认', code: 'DOWNLOAD_CONFIRMATION_REQUIRED' }; if (!args.selector) throw new Error('download 需要 selector'); const downloadDir = path.join(root, '.harness-desktop', 'browser', 'downloads'); await fs.mkdir(downloadDir, { recursive: true }); const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.locator(String(args.selector)).click({ timeout: 15000 })]); const file = path.join(downloadDir, path.basename(await download.suggestedFilename())); await download.saveAs(file); return out({ status: '已下载文件', path: path.relative(root, file), url: page.url() }) }
      if (action === 'wait') { const ms = Math.max(0, Math.min(30000, Number(args.text || args.pixels) || 1000)); await new Promise((resolve) => setTimeout(resolve, ms)); return out({ status: `已等待 ${ms}ms`, url: page.url() }) }
      return { ok: false, status: '未知 Browser action', code: 'INVALID_ACTION' }
    },
  }))
}
