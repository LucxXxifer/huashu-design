const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const sample = path.resolve(__dirname, '../samples/git-desk');

async function createDemo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'huashu-git-demo-'));
  const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'huashu-git-evidence-'));
  const cleanEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const environment = {
    ...cleanEnvironment,
    HOME: root,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Codex Teaching Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Codex Teaching Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_AUTHOR_DATE: '2026-11-21T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-11-21T00:00:00Z',
    LC_ALL: 'C',
  };
  const git = (...args) => {
    const result = spawnSync('/usr/bin/git', args, {
      cwd: root,
      env: {
        ...environment,
        GIT_DIR: path.join(root, '.git'),
        GIT_WORK_TREE: root,
        GIT_INDEX_FILE: path.join(root, '.git/index'),
        GIT_OBJECT_DIRECTORY: path.join(root, '.git/objects'),
        GIT_ALTERNATE_OBJECT_DIRECTORIES: '',
        GIT_COMMON_DIR: path.join(root, '.git'),
        GIT_PREFIX: '',
        GIT_CEILING_DIRECTORIES: root,
      },
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    if (result.error || result.status !== 0) throw new Error((result.stderr || result.error?.message || 'Git command failed').slice(0, 600));
    return result.stdout.trimEnd();
  };

  let baseCommit;
  try {
    git('init', '--quiet', '--template=', '--initial-branch=demo');
    fs.writeFileSync(path.join(root, 'field-note.txt'), 'Edit the field note.\n', { flag: 'wx' });
    git('add', '--', 'field-note.txt');
    git('-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '--no-gpg-sign', '-m', 'Start field note');
    baseCommit = git('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(root, 'field-note.txt'), 'Stage the draft.\n');
    git('add', '--', 'field-note.txt');
    fs.writeFileSync(path.join(root, 'field-note.txt'), 'Keep this second edit for later.\n');
    if (git('status', '--short') !== 'MM field-note.txt') throw new Error('The disposable fixture did not start with separate staged and unstaged edits.');
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(evidence, { recursive: true, force: true });
    throw error;
  }

  const token = crypto.randomBytes(32).toString('hex');
  let commitResult;
  let server;
  const mime = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml' };

  function receipt() {
    const head = git('rev-parse', 'HEAD');
    const [parentCommit, ...extraParents] = git('show', '-s', '--format=%P', 'HEAD').split(' ').filter(Boolean);
    return {
      baseCommit,
      commitCount: Number(git('rev-list', '--count', 'HEAD')),
      commitHash: head,
      commitSubject: git('show', '-s', '--format=%s', 'HEAD'),
      parentCommit,
      extraParents,
      headTree: git('rev-parse', 'HEAD^{tree}'),
      indexTree: git('write-tree'),
      head: git('show', 'HEAD:field-note.txt').trimEnd(),
      stage: git('show', ':field-note.txt').trimEnd(),
      working: fs.readFileSync(path.join(root, 'field-note.txt'), 'utf8').trimEnd(),
      stagedDiff: git('diff', '--cached', '--no-ext-diff', '--', 'field-note.txt').split('\n').filter(line => /^[+-][^+-]/.test(line)).join('\n'),
      workingDiff: git('diff', '--no-ext-diff', '--', 'field-note.txt').split('\n').filter(line => /^[+-][^+-]/.test(line)).join('\n'),
      gitStatus: git('status', '--short'),
    };
  }

  function send(response, status, body, type = 'application/json; charset=utf-8') {
    response.writeHead(status, {
      'content-type': type,
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
    });
    response.end(body);
  }

  server = http.createServer((request, response) => {
    const port = server.address().port;
    const url = new URL(request.url, `http://${request.headers.host || 'invalid'}`);
    const origin = `http://127.0.0.1:${port}`;
    if (request.headers.host !== `127.0.0.1:${port}`) return send(response, 421, JSON.stringify({ error: 'Host rejected.' }));
    if (request.method === 'GET' && url.pathname === '/api/state') return send(response, 200, JSON.stringify({ ...receipt(), committed: Boolean(commitResult), token }));

    if (request.method === 'POST' && url.pathname === '/api/commit') {
      if (request.headers.origin !== origin) return send(response, 403, JSON.stringify({ error: 'Same-origin requests only.' }));
      if (request.headers['x-demo-token'] !== token) return send(response, 403, JSON.stringify({ error: 'Session expired.' }));
      if ((Number(request.headers['content-length']) || 0) !== 0 || request.headers['transfer-encoding']) return send(response, 413, JSON.stringify({ error: 'A request body is not accepted.' }));
      if (commitResult) return send(response, 409, JSON.stringify({ error: 'This teaching commit was already created.' }));
      try {
        if (git('diff', '--cached', '--name-only', '--', 'field-note.txt') !== 'field-note.txt') throw new Error('No staged edit is available.');
        git('-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '--no-gpg-sign', '-m', 'Save staged version');
        commitResult = receipt();
        return send(response, 200, JSON.stringify(commitResult));
      } catch {
        return send(response, 409, JSON.stringify({ error: 'Git could not commit the staged teaching change.' }));
      }
    }

    if (request.method !== 'GET') return send(response, 405, JSON.stringify({ error: 'Method not allowed.' }));
    const relative = url.pathname === '/' ? 'commit.html' : url.pathname.slice(1);
    if (relative !== 'commit.html' && relative !== 'assets/git-logo.svg') return send(response, 404, 'Not found.', 'text/plain; charset=utf-8');
    try {
      const file = path.resolve(sample, relative);
      if (!file.startsWith(sample + path.sep)) throw new Error('Invalid sample path.');
      let body = fs.readFileSync(file);
      if (relative === 'commit.html') body = Buffer.from(body.toString('utf8').replace('const COMMIT_TOKEN = "";', `const COMMIT_TOKEN = "${token}";`));
      return send(response, 200, body, mime[path.extname(file)] || 'application/octet-stream');
    } catch {
      return send(response, 500, 'Teaching sample unavailable.', 'text/plain; charset=utf-8');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    evidence,
    receipt,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(evidence, { recursive: true, force: true });
    },
  };
}

module.exports = { createDemo };
