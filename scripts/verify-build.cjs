const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const required = [
  'package.json',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'node_modules/@deepseek-ai/dsh/LICENSE',
  'node_modules/electron/dist/LICENSES.chromium.html',
  'build/icon.png',
  'src/main.cjs',
  'src/preload.cjs',
  'src/settings.html',
  'src/settings-renderer.js',
  'src/settings-preload.cjs',
  'src/secure-store.cjs',
  'src/vision-bridge.cjs',
  'src/workbench-service.cjs',
  'src/workbench-preload.cjs',
  'src/workbench-renderer.js',
  'src/workbench.css',
  'src/workbench.html',
  'src/shared-context-service.cjs',
  'src/codex-app-server-client.cjs',
  'src/usage.html',
  'src/usage-renderer.js',
  'src/usage-preload.cjs',
  'src/agent-levels.cjs',
  'src/app-data-service.cjs',
  'src/pricing-metadata.json',
  'browser-plugin/index.mjs',
  'src/marketplace.html',
  'src/marketplace-service.cjs',
  'src/marketplace.css',
  'src/marketplace-renderer.js',
  'src/marketplace-preload.cjs',
  'node_modules/@deepseek-ai/dsh/lib/bin.js',
];
for (const relative of required) {
  if (!fs.existsSync(path.join(root, relative))) throw new Error(`build prerequisite missing: ${relative}`);
}
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (packageJson.dependencies['@deepseek-ai/dsh'] !== '0.1.0-rc.6') throw new Error('official dsh version is not pinned to 0.1.0-rc.6');
console.log(`verified ${required.length} files; @deepseek-ai/dsh ${packageJson.dependencies['@deepseek-ai/dsh']}`);
