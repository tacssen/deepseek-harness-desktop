const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const required = [
  'package.json',
  'src/main.cjs',
  'src/preload.cjs',
  'src/settings.html',
  'src/settings-renderer.js',
  'src/settings-preload.cjs',
  'src/secure-store.cjs',
  'src/vision-bridge.cjs',
  'node_modules/@deepseek-ai/dsh/lib/bin.js',
];
for (const relative of required) {
  if (!fs.existsSync(path.join(root, relative))) throw new Error(`build prerequisite missing: ${relative}`);
}
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (packageJson.dependencies['@deepseek-ai/dsh'] !== '0.1.0-rc.6') throw new Error('official dsh version is not pinned to 0.1.0-rc.6');
console.log(`verified ${required.length} files; @deepseek-ai/dsh ${packageJson.dependencies['@deepseek-ai/dsh']}`);
