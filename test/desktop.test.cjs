const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { validateImage, dataURL, MAX_BYTES, makePng } = require('../src/vision-bridge.cjs');
const { redact } = require('../src/logger.cjs');
const { SecureStore } = require('../src/secure-store.cjs');

test('vision validates MIME and 5 MB boundary and emits data URL', () => {
  const input = makePng(20, 20);
  const result = validateImage(input, 'image/png');
  assert.equal(result.mime, 'image/png');
  assert.match(dataURL(result.buffer, result.mime), /^data:image\/png;base64,/);
  assert.throws(() => validateImage(Buffer.concat([makePng(20, 20), Buffer.alloc(MAX_BYTES)]), 'image/png'), /5 MB/);
  assert.throws(() => validateImage(input, 'text/plain'), /MIME/);
});

test('logs redact bearer/API key material', () => {
  const value = redact('Authorization: Header fixture-vision-secret apiKey=fixture-other-secret');
  assert.ok(!value.includes('super-secret'));
  assert.ok(!value.includes('other-secret'));
  assert.match(value, /REDACTED/);
});

test('secure store persists preferences and DPAPI ciphertext without plaintext key', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-desktop-'));
  const fakeApp = { getPath: () => dir };
  const fakeSafeStorage = { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(`cipher:${value}`, 'utf8'), decryptString: (buffer) => buffer.toString('utf8').replace(/^cipher:/, '') };
  const store = new SecureStore(fakeApp, fakeSafeStorage);
  store.load();
  await store.save({
    deepseek: { baseURL: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
    vision: {
      enabled: true,
      provider: 'glm',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      model: 'glm-4.6v-flash',
    },
    deepseekApiKey: 'fixture-api-key',
    visionApiKey: 'fixture-vision-key',
  });
  const disk = await fs.readFile(path.join(dir, 'settings.secure.json'), 'utf8');
  assert.ok(!disk.includes('fixture-api-key'));
  assert.ok(!disk.includes('fixture-vision-key'));
  assert.equal(store.getSecret('deepseekApiKey'), 'fixture-api-key');
  assert.equal(store.getSecret('visionApiKey'), 'fixture-vision-key');
  assert.equal(store.publicSettings().deepseek.apiKeyConfigured, true);
  assert.equal(store.publicSettings().vision.apiKeyConfigured, true);
  assert.equal(store.publicSettings().vision.status, 'Vision Ready');
});
