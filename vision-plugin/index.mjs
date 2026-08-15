import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

export const name = 'vision-analyze'
export const inject = ['tools', 'credentials']

const API_KEY = credentialRef('VISION_API_KEY')
const DEFAULT_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
const DEFAULT_MODEL = 'glm-4.6v-flash'
const MAX_BYTES = 5 * 1024 * 1024
const cache = new Map()

function parseImage(data) {
  if (typeof data !== 'string') throw new Error('data must be an image data URL')
  const match = data.match(/^data:(image\/(?:png|jpeg|jpg));base64,([A-Za-z0-9+/=]+)$/i)
  if (!match) throw new Error('only PNG/JPEG data URLs are accepted')
  const mime = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase()
  const buffer = Buffer.from(match[2], 'base64')
  if (buffer.length === 0 || buffer.length > MAX_BYTES) throw new Error('image must be between 1 byte and 5 MB')
  const dimensions = dimensionsOf(buffer, mime)
  if (!dimensions || dimensions.width < 28 || dimensions.height < 28 || dimensions.width > 6000 || dimensions.height > 6000) throw new Error('image dimensions must be between 28x28 and 6000x6000 pixels')
  return { mime, buffer, ...dimensions }
}

async function parseWorkspaceImage(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('path must be a workspace image path')
  const workspace = await fs.realpath(process.cwd())
  const candidate = path.resolve(workspace, filePath)
  const resolved = await fs.realpath(candidate)
  const relative = path.relative(workspace, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('image path must stay inside the active workspace')
  const stat = await fs.stat(resolved)
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_BYTES) throw new Error('image must be a regular file between 1 byte and 5 MB')
  const extension = path.extname(resolved).toLowerCase()
  const mime = extension === '.png' ? 'image/png' : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : undefined
  if (!mime) throw new Error('only PNG/JPEG workspace images are accepted')
  const buffer = await fs.readFile(resolved)
  const dimensions = dimensionsOf(buffer, mime)
  if (!dimensions || dimensions.width < 28 || dimensions.height < 28 || dimensions.width > 6000 || dimensions.height > 6000) throw new Error('image dimensions must be between 28x28 and 6000x6000 pixels')
  return { mime, buffer, ...dimensions }
}

function dimensionsOf(buffer, mime) {
  if (mime === 'image/png' && buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47 && buffer.readUInt32BE(4) === 0x0d0a1a0a) return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  if (mime === 'image/jpeg' && buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue }
      const marker = buffer[offset + 1]; offset += 2
      if (marker === 0xd8 || marker === 0xd9) continue
      if (offset + 2 > buffer.length) break
      const length = buffer.readUInt16BE(offset)
      if (length < 2 || offset + length > buffer.length) break
      const sof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)
      if (sof && length >= 7) return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) }
      offset += length
    }
  }
  return undefined
}

function resultSchema() {
  return { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, status: { type: 'string' }, text: { type: 'string' }, sha256: { type: 'string' }, code: { type: 'string' } } }
}

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'vision_analyze',
    description: 'Analyze a validated PNG/JPEG image through the independent GLM Vision bridge. Accepts either a workspace path or an image data URL. Images never go to DeepSeek.',
    parameters: { data: { type: 'string', description: 'Base64 image data URL, <=5 MB.' }, path: { type: 'string', description: 'PNG/JPEG path inside the active workspace.' }, prompt: { type: 'string', description: 'Short image question.' } },
    output: { schema: resultSchema(), render: (_args, value) => [{ type: 'text', text: value.ok ? value.text : `${value.status}${value.code ? ` (${value.code})` : ''}` }] },
    async execute(args, exec) {
      if (exec.signal.aborted) return { ok: false, status: 'Cancelled', code: 'ABORTED' }
      if (Boolean(args.data) === Boolean(args.path)) return { ok: false, status: 'Provide exactly one of data or path', code: 'INVALID_IMAGE_SOURCE' }
      const image = args.path ? await parseWorkspaceImage(args.path) : parseImage(args.data)
      const key = await ctx.credentials.resolve(API_KEY)
      if (!key?.value) return { ok: false, status: 'Awaiting API Key', code: 'MISSING_CREDENTIAL' }
      const imageHash = crypto.createHash('sha256').update(image.buffer).digest('hex')
      const endpoint = String(process.env.VISION_BASE_URL || DEFAULT_ENDPOINT).replace(/\/$/, '')
      const model = String(process.env.VISION_MODEL || DEFAULT_MODEL)
      const provider = String(process.env.VISION_PROVIDER || 'bigmodel')
      const prompt = args.prompt || 'Describe this image briefly.'
      const cacheKey = crypto.createHash('sha256').update(JSON.stringify({ imageHash, prompt, provider, model, endpoint })).digest('hex')
      const cached = cache.get(cacheKey)
      if (cached) return { ...cached, sha256: imageHash }
      const imageURL = { url: `data:${image.mime};base64,${image.buffer.toString('base64')}`, ...(provider === 'siliconflow' ? { detail: 'high' } : {}) }
      const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${key.value}`, 'Content-Type': 'application/json' }, signal: exec.signal, body: JSON.stringify({ model, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: imageURL }] }], max_tokens: 256, stream: false }) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) return { ok: false, status: `Vision HTTP ${response.status}`, code: `HTTP_${response.status}`, sha256: imageHash }
      const content = body?.choices?.[0]?.message?.content
      const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((part) => part?.text || '').join('') : ''
      if (!text) return { ok: false, status: 'Vision provider returned no text', code: 'EMPTY_RESPONSE', sha256: imageHash }
      const result = { ok: true, status: 'Vision Ready', text }
      cache.set(cacheKey, result)
      return { ...result, sha256: imageHash }
    },
  }))
}
