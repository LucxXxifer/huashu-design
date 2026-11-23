const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '../..');
const skill = process.env.HUASHU_TEST_SKILL || path.join(repo, 'skills/huashu-design-codex');
const cli = path.join(skill, 'scripts/huashu.cjs');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "huashu-codex-test-"));
process.env.HUASHU_NODE_MODULES ||= path.join(__dirname, '..', 'node_modules');

function fixture(name, config, files = {}) {
  const folder = path.join(sandbox, name);
  fs.mkdirSync(folder);
  for (const [filename, content] of Object.entries(files)) {
    const destination = path.join(folder, filename);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  }
  const input = path.join(folder, 'input.json');
  fs.writeFileSync(input, JSON.stringify(config));
  return { input, output: path.join(folder, 'verification') };
}

async function run(kind, job, environment = {}, timeout = 200000) {
  const proc = spawn(process.execPath, [cli, kind, job.input, job.output], {
    env: { ...process.env, ...environment }, detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '', timedOut = false;
  proc.stdout.setEncoding('utf8').on('data', data => { stdout += data; });
  proc.stderr.setEncoding('utf8').on('data', data => { stderr += data; });
  let timer;
  const timeoutError = new Promise(resolve => { timer = setTimeout(() => {
    timedOut = true;
    cleanupProcessTree(proc.pid).then(() => resolve({ code: null, signal: 'SIGKILL' }));
  }, timeout); });
  const exited = new Promise((resolve, reject) => {
    proc.once('error', reject);
    proc.once('close', (code, signal) => resolve({ code, signal, timedOut: false }));
  });
  const status = await Promise.race([exited, timeoutError]);
  clearTimeout(timer);
  if (timedOut) {
    const error = new Error(`${kind} exceeded the ${timeout}ms test deadline; its subprocess group was terminated.`);
    error.code = 'ETIMEDOUT';
    throw error;
  }
  const receipt = path.join(job.output, 'result.json');
  assert.ok(fs.existsSync(receipt), `missing result for ${kind}: ${stderr}`);
  return { code: status.code, report: JSON.parse(fs.readFileSync(receipt, 'utf8')), output: job.output, stdout, stderr };
}

async function cleanupProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  const signalTree = signal => {
    try {
      if (process.platform !== 'win32') process.kill(-pid, signal);
      else process.kill(pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  signalTree('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 750));
  signalTree('SIGKILL');
}

async function runWithTimeout(command, args, { timeout, cwd, env, marker }) {
  const proc = spawn(command, args, { cwd, env, detached: process.platform !== 'win32', stdio: 'ignore' });
  let timedOut = false;
  const exit = new Promise((resolve, reject) => {
    proc.once('error', reject);
    proc.once('close', (code, signal) => resolve({ code, signal }));
  });
  let timer;
  const deadline = new Promise(resolve => { timer = setTimeout(() => {
    timedOut = true;
    cleanupProcessTree(proc.pid).then(resolve);
    resolve();
  }, timeout); });
  const status = await Promise.race([exit, deadline.then(() => exit)]);
  clearTimeout(timer);
  return { ...status, timedOut, marker: marker && fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : '' };
}

function assertPassed(result) {
  assert.equal(result.code, 0, JSON.stringify(result.report));
  assert.equal(result.report.status, 'passed', JSON.stringify(result.report));
}

function assertOpaqueWhitePng(buffer, sharp) {
  return sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true }).then(({ data, info }) => {
    assert.equal(info.channels, 4);
    assert.ok(data.some((value, offset) => offset % 4 === 0 && value !== 255));
    for (let offset = 3; offset < data.length; offset += 4) assert.equal(data[offset], 255);
  });
}

function cleanup() {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

module.exports = { assertOpaqueWhitePng, assertPassed, cleanup, fixture, repo, run, runWithTimeout, sandbox, skill };
