const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg']);

function validateImage(input, mime) {
  let buffer;
  if (Buffer.isBuffer(input)) buffer = input;
  else if (input instanceof Uint8Array) buffer = Buffer.from(input);
  else if (typeof input === 'string') {
    const match = input.match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) throw new Error('Vision input must be a base64 data URL');
    mime = match[1].toLowerCase();
    buffer = Buffer.from(match[2], 'base64');
  } else throw new Error('Vision input is missing');
  let normalizedMime = String(mime || '').toLowerCase();
  if (!ALLOWED_MIME.has(normalizedMime)) throw new Error('Vision MIME must be PNG or JPEG');
  if (normalizedMime === 'image/jpg') normalizedMime = 'image/jpeg';
  if (buffer.length === 0 || buffer.length > MAX_BYTES) throw new Error('Vision image must be between 1 byte and 5 MB');
  const dimensions = imageDimensions(buffer, normalizedMime);
  if (!dimensions || dimensions.width < 28 || dimensions.height < 28 || dimensions.width > 6000 || dimensions.height > 6000) {
    throw new Error('Vision image dimensions must be between 28x28 and 6000x6000 pixels');
  }
  return { buffer, mime: normalizedMime, ...dimensions };
}

function dataURL(buffer, mime) {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

class VisionBridge {
  constructor(app, store, logger) {
    this.app = app;
    this.store = store;
    this.logger = logger;
    this.memory = new Map();
    this.cacheDir = path.join(app.getPath('userData'), 'cache', 'vision');
  }

  status() {
    const settings = this.store.publicSettings();
    return {
      enabled: Boolean(settings.vision.enabled),
      ready: Boolean(settings.vision.enabled && settings.vision.apiKeyConfigured),
      text: settings.vision.status,
      provider: settings.vision.provider,
      model: settings.vision.model,
    };
  }

  async analyze({ data, mime, prompt = 'Describe this image briefly.' } = {}) {
    const settings = this.store.publicSettings();
    if (!settings.vision.enabled) return { ok: false, status: 'Vision Disabled', code: 'DISABLED' };
    const key = this.store.getSecret('visionApiKey');
    if (!key) return { ok: false, status: 'Awaiting API Key', code: 'MISSING_CREDENTIAL' };
    const image = validateImage(data, mime);
    const imageHash = crypto.createHash('sha256').update(image.buffer).digest('hex');
    const cacheInput = JSON.stringify({ imageHash, prompt: String(prompt), provider: settings.vision.provider, model: settings.vision.model, baseURL: settings.vision.baseURL });
    const hash = crypto.createHash('sha256').update(cacheInput).digest('hex');
    const cacheFile = path.join(this.cacheDir, `${hash}.json`);
    const cached = this.memory.get(hash) || await this.readCache(cacheFile);
    if (cached) return { ...cached, cached: true, sha256: imageHash };
    const response = await this.callProvider(settings.vision, key, dataURL(image.buffer, image.mime), prompt);
    const result = { ok: true, status: 'Vision Ready', provider: settings.vision.provider, model: settings.vision.model, text: response.text, createdAt: new Date().toISOString() };
    this.memory.set(hash, result);
    await fsp.mkdir(this.cacheDir, { recursive: true }).catch(() => {});
    await fsp.writeFile(cacheFile, `${JSON.stringify(result)}\n`, 'utf8').catch(() => {});
    return { ...result, cached: false, sha256: imageHash };
  }

  async test(settings = this.store.publicSettings().vision) {
    const key = this.store.getSecret('visionApiKey');
    if (!key) return { ok: false, status: 'Awaiting API Key', code: 'MISSING_CREDENTIAL' };
    // A valid 20x20 PNG satisfies the provider minimum image dimensions.
    const pixel = makePng(56, 56);
    try {
      const response = await this.callProvider(settings, key, dataURL(pixel, 'image/png'), 'Reply with the single word OK.');
      return { ok: true, status: 'Vision Ready', model: settings.model, preview: response.text.slice(0, 120) };
    } catch (error) {
      return { ok: false, status: 'Vision Error', code: error.code || 'VISION_REQUEST_FAILED', error: safeError(error) };
    }
  }

  async callProvider(settings, key, imageURL, prompt) {
    const endpoint = String(settings.baseURL || '').replace(/\/$/, '');
    if (!/^https?:\/\//i.test(endpoint)) throw Object.assign(new Error('Vision endpoint is invalid'), { code: 'INVALID_ENDPOINT' });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: settings.model, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageURL } }] }], max_tokens: 256, stream: false }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(`Vision provider HTTP ${response.status}`), { code: `HTTP_${response.status}` });
      const text = extractText(body);
      if (!text) throw Object.assign(new Error('Vision provider returned no text'), { code: 'EMPTY_RESPONSE' });
      return { text };
    } catch (error) {
      if (error && error.name === 'AbortError') throw Object.assign(new Error('Vision provider timed out'), { code: 'TIMEOUT' });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async readCache(file) {
    try {
      const value = JSON.parse(await fsp.readFile(file, 'utf8'));
      return value && value.ok && typeof value.text === 'string' ? value : undefined;
    } catch { return undefined; }
  }
}

function extractText(body) {
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => typeof part === 'string' ? part : part?.text || '').join('');
  return typeof body?.output_text === 'string' ? body.output_text : '';
}

function safeError(error) {
  const code = error?.code || 'VISION_REQUEST_FAILED';
  return `${code}: ${String(error?.message || 'request failed').replace(/sk-[A-Za-z0-9._-]+/g, 'sk-[REDACTED]')}`;
}

module.exports = { VisionBridge, validateImage, dataURL, MAX_BYTES, ALLOWED_MIME };

function imageDimensions(buffer, mime) {
  if (mime === 'image/png' && buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47 && buffer.readUInt32BE(4) === 0x0d0a1a0a) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (mime === 'image/jpeg' && buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1]; offset += 2;
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (offset + 2 > buffer.length) break;
      const segmentLength = buffer.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
      const isSOF = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
      if (isSOF && segmentLength >= 7) return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
      offset += segmentLength;
    }
  }
  return undefined;
}

function makePng(width, height) {
  const row = Buffer.alloc(width * 3, 0xff); const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (row.length + 1)] = 0; row.copy(raw, y * (row.length + 1) + 1); }
  const chunk = (type, payload) => { const header = Buffer.alloc(8); header.writeUInt32BE(payload.length, 0); Buffer.from(type).copy(header, 4); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), payload])), 0); return Buffer.concat([header, payload, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function crc32(buffer) { let crc = 0xffffffff; for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }

module.exports.makePng = makePng;
