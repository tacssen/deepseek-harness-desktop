const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ignored = new Set(['.git', '.dsh', '.proof-home', '.reference', '_upstream', 'dist', 'node_modules', 'runtime-stage']);
const textExtensions = new Set(['', '.cjs', '.js', '.json', '.md', '.ps1', '.ts', '.txt', '.yaml', '.yml', '.html', '.css', '.svg', '.gitignore']);
const rules = [
  ['API key', /\bsk-[A-Za-z0-9._-]{20,}\b/g],
  ['Bearer token', /authorization\s*[:=]\s*bearer\s+[A-Za-z0-9._~+/-]{16,}/gi],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['personal Windows path', /C:\\Users\\(?!<user>|USERNAME|example|user\b)[^\\\s"'`]+/gi],
];
const findings = [];

function visit(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ignored.has(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (entry.isFile()) scan(file);
  }
}

function scan(file) {
  const relative = path.relative(root, file).replace(/\\/g, '/');
  if (/^\.agents\/(HANDOFF|TASKS|MEMORY|TESTS|project-state\.json|locks\/|sessions\/|checkpoints\/)/i.test(relative)) return;
  if (!textExtensions.has(path.extname(file).toLowerCase()) && path.basename(file) !== '.gitignore') return;
  const stat = fs.statSync(file); if (stat.size > 2 * 1024 * 1024) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const [label, pattern] of rules) {
    pattern.lastIndex = 0; let match;
    while ((match = pattern.exec(text))) {
      if (/\[REDACTED\]|<key>|example/i.test(match[0])) continue;
      const line = text.slice(0, match.index).split(/\r?\n/).length;
      findings.push({ file: relative, line, label });
    }
  }
}

visit(root);
if (findings.length) {
  for (const item of findings) console.error(`${item.file}:${item.line}: ${item.label}`);
  console.error(`secret scan failed with ${findings.length} finding(s); values were not printed`);
  process.exit(1);
}
console.log('secret scan passed; no credential or personal-path patterns found');
