/*
 * Build a production-only Node runtime for the official dsh child. Electron's
 * dependency pruning omits several dsh peer dependencies (for example
 * dsh-scope and dsh-timeout), so the packaged desktop app carries a complete
 * npm --omit=dev tree outside app.asar. No credentials are copied here.
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const stage = path.join(root, 'runtime-stage');

function fail(message) {
  console.error(`[prepare-runtime] ${message}`);
  process.exitCode = 1;
}

async function main() {
  await fsp.rm(stage, { recursive: true, force: true });
  await fsp.mkdir(stage, { recursive: true });
  await fsp.copyFile(path.join(root, 'package.json'), path.join(stage, 'package.json'));
  await fsp.copyFile(path.join(root, 'package-lock.json'), path.join(stage, 'package-lock.json'));
  await fsp.cp(path.join(root, 'vision-plugin'), path.join(stage, 'vision-plugin'), { recursive: true });
  // Spawning npm.cmd directly returns EINVAL on some Windows Node builds;
  // invoke npm's JS entrypoint with the current Node executable instead.
  const npm = process.platform === 'win32'
    ? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : 'npm';
  const npmArgs = process.platform === 'win32'
    ? [npm, 'ci', '--omit=dev', '--no-audit', '--no-fund']
    : ['ci', '--omit=dev', '--no-audit', '--no-fund'];
  const result = spawnSync(process.platform === 'win32' ? process.execPath : npm, npmArgs, {
    cwd: stage,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm ci exited with ${result.status}`);
  const required = [
    path.join(stage, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    path.join(stage, 'node_modules', '@deepseek-ai', 'dsh-scope'),
    path.join(stage, 'node_modules', '@deepseek-ai', 'dsh-timeout'),
    path.join(stage, 'node_modules', '@deepseek-harness', 'vision-plugin'),
  ];
  const missing = required.filter((item) => !fs.existsSync(item));
  if (missing.length) throw new Error(`runtime staging is missing: ${missing.join(', ')}`);
  const count = fs.readdirSync(path.join(stage, 'node_modules')).length;
  console.log(`[prepare-runtime] production node_modules ready (${count} top-level entries)`);
}

main().catch((error) => fail(error.message || String(error)));
