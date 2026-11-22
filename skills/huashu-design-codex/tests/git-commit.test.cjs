const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { withBrowser } = require('../scripts/browser.cjs');
const { createDemo } = require('../scripts/git-demo-server.cjs');
const { runWithTimeout } = require('../../../codex/tests/test-helpers.cjs');

const before = {
  label: 'Before commit',
  head: 'Edit the field note.',
  index: 'Stage the draft.',
  disk: 'Keep this second edit for later.',
  staged: '-Edit the field note.\n+Stage the draft.',
  unstaged: '-Stage the draft.\n+Keep this second edit for later.',
};
const after = {
  label: 'After commit',
  head: 'Stage the draft.',
  index: 'Stage the draft.',
  disk: 'Keep this second edit for later.',
  staged: 'No staged changes.',
  unstaged: before.unstaged,
};

test('the demo ignores Git repository and configuration inherited from the caller', { timeout: 15000 }, async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'huashu-outer-repo-'));
  const hookMarker = path.join(os.tmpdir(), `huashu-git-config-${process.pid}-${Date.now()}`);
  try {
    const hookSource = path.join(outside, 'config-injected-hook');
    const git = spawnSync('/usr/bin/git', ['init', '--quiet', '--template=', '--initial-branch=outer', outside], {
      env: { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(git.status, 0, git.stderr);
    fs.writeFileSync(hookSource, `#!/bin/sh\nprintf invoked > "${hookMarker}"\n`);
    fs.chmodSync(hookSource, 0o755);
    const templateDir = path.join(outside, 'malicious-template');
    const templateHook = path.join(templateDir, 'hooks/pre-commit');
    fs.mkdirSync(path.dirname(templateHook), { recursive: true });
    fs.writeFileSync(templateHook, `#!/bin/sh\nprintf invoked > "${hookMarker}"\n`);
    fs.chmodSync(templateHook, 0o755);
    const poisoned = spawnSync('/usr/bin/git', ['-C', outside, 'config', '--local', 'core.hooksPath', hookSource], {
      env: { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(poisoned.status, 0, poisoned.stderr);
    const script = `const { createDemo } = require(process.argv[1]);
      (async () => { const demo = await createDemo(); try {
        process.stdout.write(JSON.stringify(demo.receipt()));
      } finally { await demo.close(); } })().catch(error => { console.error(error.message); process.exitCode = 1; });`;
    const inherited = { ...process.env };
    for (const key of Object.keys(inherited)) if (key.startsWith('GIT_')) delete inherited[key];
    Object.assign(inherited, {
      GIT_DIR: path.join(outside, '.git'),
      GIT_WORK_TREE: outside,
      GIT_INDEX_FILE: path.join(outside, '.git/index'),
      GIT_TEMPLATE_DIR: templateDir,
      GIT_CONFIG_SYSTEM: hookSource,
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: hookSource,
    });
    const head = path.join(outside, '.git/HEAD');
    const original = fs.readFileSync(head, 'utf8');
    const hung = spawnSync(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL',
    });
    assert.equal(hung.error?.code, 'ETIMEDOUT');
    assert.equal(hung.status, null);
    assert.equal(hung.signal, 'SIGKILL');

    const demo = spawnSync(process.execPath, ['-e', script, require.resolve('../scripts/git-demo-server.cjs')], {
      env: inherited,
      encoding: 'utf8', timeout: 12000,
    });
    assert.equal(demo.status, 0, `${demo.stderr}\n${demo.stdout}`);
    assert.equal(JSON.parse(demo.stdout).gitStatus, 'MM field-note.txt');
    assert.equal(fs.readFileSync(head, 'utf8'), original);
    assert.deepEqual(fs.readdirSync(outside).sort(), ['.git', 'config-injected-hook', 'malicious-template']);
    assert.equal(fs.existsSync(path.join(outside, '.git/index')), false);
    assert.deepEqual(fs.readdirSync(path.join(outside, '.git/refs/heads')), []);
    assert.equal(fs.existsSync(hookMarker), false);
  } finally {
    fs.rmSync(hookMarker, { force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('a test deadline terminates the renderer and its spawned process group', { timeout: 15000 }, async () => {
  const marker = path.join(os.tmpdir(), `huashu-timeout-child-${process.pid}-${Date.now()}`);
  const childScript = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'survived'), 900)`;
  const parentScript = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { stdio: 'ignore' }); setInterval(() => {}, 1000)`;
  try {
    const result = await runWithTimeout(process.execPath, ['-e', parentScript], { timeout: 250, marker });
    assert.equal(result.timedOut, true);
    assert.ok(result.signal);
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.equal(fs.existsSync(marker), false, 'a timed-out renderer child was left running');
  } finally {
    fs.rmSync(marker, { force: true });
  }
});

test('Commit staged advances only the disposable Git repository and preserves unstaged edits', { timeout: 45000 }, async () => {
  await withBrowser(async browser => {
    for (const width of [375, 1440]) {
      const demo = await createDemo();
      try {
        const page = await browser.newPage({ viewport: { width, height: width === 375 ? 812 : 900 } });
        await page.route('**/*', route => new URL(route.request().url()).origin === new URL(demo.url).origin ? route.continue() : route.abort());
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(demo.url, { waitUntil: 'load', timeout: 10000 });
        await waitForPhase(page, before.label);
        await assertState(page, before);
        const prior = demo.receipt();
        assert.equal(prior.commitCount, 1);
        assert.equal(prior.gitStatus, 'MM field-note.txt');
        if (process.env.HUASHU_TEST_EVIDENCE) await capture(page, width, 'before-commit');

        const endpoint = new URL('api/commit', demo.url).href;
        const state = await page.request.get(new URL('api/state', demo.url).href).then(response => response.json());
        const authorized = { origin: new URL(demo.url).origin, 'x-demo-token': state.token };
        assert.equal((await page.request.post(endpoint, { headers: { ...authorized, origin: 'https://example.invalid' } })).status(), 403);
        assert.equal((await page.request.post(endpoint, { headers: { ...authorized, 'x-demo-token': 'wrong' } })).status(), 403);
        assert.equal((await page.request.post(endpoint, { headers: authorized, data: { path: 'field-note.txt' } })).status(), 413);
        assert.equal(demo.receipt().commitHash, prior.commitHash);
        await page.getByRole('button', { name: 'Commit staged' }).click();
        await waitForPhase(page, after.label);
        await assertState(page, after);
        const receipt = demo.receipt();
        assert.equal(receipt.commitCount, 2);
        assert.equal(receipt.commitSubject, 'Save staged version');
        assert.match(receipt.commitHash, /^[0-9a-f]{40}$/);
        assert.notEqual(receipt.commitHash, prior.commitHash);
        assert.equal(receipt.parentCommit, prior.commitHash);
        assert.equal(receipt.indexTree, prior.indexTree);
        assert.equal(receipt.headTree, prior.indexTree);
        assert.equal(receipt.workingDiff, before.unstaged);
        assert.equal(receipt.gitStatus, ' M field-note.txt');
        const displayedHash = page.locator('#commit-hash');
        assert.equal(await displayedHash.isVisible(), true);
        assert.equal(await displayedHash.textContent(), receipt.commitHash.slice(0, 12));
        assert.equal((await page.request.post(endpoint, { headers: authorized })).status(), 409);
        await page.reload({ timeout: 10000 });
        await waitForPhase(page, after.label);
        await assertState(page, after);
        assert.equal(demo.receipt().commitCount, 2);
        assert.deepEqual(errors, []);
        if (process.env.HUASHU_TEST_EVIDENCE) {
          await capture(page, width, 'after-commit');
          const evidence = { before: prior, after: receipt };
          fs.writeFileSync(path.join(process.env.HUASHU_TEST_EVIDENCE, `commit-${width}.json`), JSON.stringify(evidence, null, 2) + '\n');
        }
        await page.close();
      } finally {
        await demo.close();
      }
    }
  });
});

function capture(page, width, phase) {
  return page.screenshot({ path: path.join(process.env.HUASHU_TEST_EVIDENCE, `${phase}-${width}.png`), fullPage: true });
}

function waitForPhase(page, phase) {
  return page.waitForFunction(expected => document.querySelector('#phase').textContent === expected, phase, { timeout: 12000 });
}

async function assertState(page, expected) {
  const current = await page.evaluate(() => ({
    label: document.querySelector('#phase').textContent,
    head: document.querySelector('#head').textContent,
    index: document.querySelector('#stage').textContent,
    disk: document.querySelector('#working').textContent,
    staged: document.querySelector('#staged-diff').textContent,
    unstaged: document.querySelector('#working-diff').textContent,
    buttonDisabled: document.querySelector('#commit').disabled,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
  }));
  assert.equal(current.label, expected.label);
  assert.equal(current.head, expected.head);
  assert.equal(current.index, expected.index);
  assert.equal(current.disk, expected.disk);
  assert.equal(current.staged, expected.staged);
  assert.equal(current.unstaged, expected.unstaged);
  assert.equal(current.buttonDisabled, expected.label === 'After commit');
  assert.equal(current.overflow, false);
}
