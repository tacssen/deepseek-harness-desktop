const fs = require('node:fs');

async function main() {
  const key = fs.readFileSync(0, 'utf8').trim();
  if (!key || /[\r\n]/.test(key)) throw new Error('credential missing');
  const response = await fetch('https://api.siliconflow.cn/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`SiliconFlow models HTTP ${response.status}`);
  const ids = (Array.isArray(body.data) ? body.data : []).map((item) => item?.id).filter((id) => /glm.*v|vision|vl/i.test(id));
  process.stdout.write(`${JSON.stringify(ids, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
