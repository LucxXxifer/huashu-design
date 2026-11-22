const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');

class Problem extends Error {
  constructor(code, message, status = 'failed') {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function dependency(name) {
  const explicit = process.env.HUASHU_NODE_MODULES;
  const bundled = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
  try {
    if (explicit) return require(path.resolve(explicit, name));
    const resolve = createRequire(__filename);
    try { return resolve(name); } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
      return require(path.join(bundled, name));
    }
  } catch (error) {
    throw new Problem('MISSING_DEPENDENCY', `Cannot load ${name}: ${error.message.split('\n')[0]}`, 'skipped');
  }
}

function check(condition, message, code = 'INVALID_JOB') {
  if (!condition) throw new Problem(code, message);
}

function integer(number, min, max) {
  return Number.isInteger(number) && number >= min && number <= max;
}

function size(value, max = 8192) {
  check(Array.isArray(value) && value.length === 2 && value.every(n => integer(n, 1, max)), 'Expected [width,height] in pixels.');
  return value;
}

function localFile(root, relative) {
  check(typeof relative === 'string' && relative.length && !path.isAbsolute(relative) && !relative.includes('\\') &&
    !relative.split('/').includes('..'), 'Expected a file inside the manifest directory.', 'PATH_OUTSIDE_JOB');
  let real;
  try { real = fs.realpathSync(path.resolve(root, relative)); } catch (error) {
    if (error.code === 'ENOENT') throw new Problem('FILE_MISSING', `Missing job file: ${relative}`);
    throw error;
  }
  check(real.startsWith(root + path.sep), `File escapes the job directory: ${relative}`, 'PATH_OUTSIDE_JOB');
  check(fs.statSync(real).isFile(), `Not a regular file: ${relative}`);
  return real;
}

function tool(command, args, { timeout = 60000, code = 'COMMAND_FAILED', cwd } = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout, cwd, maxBuffer: 8 * 1024 * 1024, killSignal: 'SIGKILL' });
  if (result.error?.code === 'ENOENT') throw new Problem('MISSING_DEPENDENCY', `Command not found: ${command}`, 'skipped');
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || (result.stderr || result.stdout || '').trim().split('\n').slice(-8).join('\n');
    throw new Problem(code, `${path.basename(command)} failed (${result.status ?? result.signal ?? 'no exit'}): ${detail}`);
  }
  return result;
}

async function scratch(out, fn) {
  const temp = fs.mkdtempSync(path.join(out, '.render-'));
  try { return await fn(temp); } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

const normalized = text => text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
const hasText = (actual, expected) => normalized(actual).includes(normalized(expected));

module.exports = { Problem, dependency, check, integer, size, localFile, tool, scratch, hasText };
