const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

function redact(text) {
  let value = String(text ?? '');
  value = value.replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,'"}]+/gi, '$1[REDACTED]');
  value = value.replace(/(api[_ -]?key|token|secret|password)\s*[:=]\s*["']?[^\s,"'}]+/gi, '$1=[REDACTED]');
  value = value.replace(/\bsk-[A-Za-z0-9._-]{6,}\b/g, 'sk-[REDACTED]');
  return value.length > 4000 ? `${value.slice(0, 4000)}...[truncated]` : value;
}

class Logger {
  constructor(app) {
    this.app = app;
    this.file = path.join(app.getPath('logs'), 'desktop.log');
    this.queue = Promise.resolve();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
  }

  write(level, message) {
    const line = `${new Date().toISOString()} [${level}] ${redact(message)}\n`;
    this.queue = this.queue.then(() => fsp.appendFile(this.file, line, 'utf8')).catch(() => {});
    return line.trimEnd();
  }

  info(message) { return this.write('INFO', message); }
  warn(message) { return this.write('WARN', message); }
  error(message) { return this.write('ERROR', message); }
}

module.exports = { Logger, redact };
