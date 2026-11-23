const assert = require('node:assert/strict');
const { cpSync, mkdtempSync, rmSync, writeFileSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { after, test } = require('node:test');
const { createHash } = require('node:crypto');
const JSZip = require('jszip');
const { cleanup, repo } = require('./test-helpers.cjs');

after(cleanup);

const python = process.env.PYTHON || 'python3';
const builder = path.join(repo, 'scripts/build-release-archive.py');
const verifier = path.join(repo, 'scripts/verify-release-archive.py');
const packageRoot = 'huashu-design-codex';

test('builds and verifies the actual distributable file set and its content digests', { timeout: 30000 }, async () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'huashu-release-archive-'));
  const output = path.join(scratch, 'dist');
  const archive = path.join(output, `${packageRoot}.zip`);
  const manifestPath = path.join(output, 'PACKAGE-MANIFEST.json');
  try {
    const built = spawnSync(python, [builder, repo, output], { encoding: 'utf8', timeout: 15000 });
    assert.ifError(built.error);
    assert.equal(built.status, 0, built.stderr);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.ok(manifest.some(file => file.path === 'skills/huashu-design-codex/scripts/huashu.cjs'));
    assert.ok(manifest.some(file => file.path === 'skills/huashu-design-codex/assets/wechat_frame.jsx'));
    for (const name of ['package.json', 'package-lock.json']) {
      const packaged = manifest.find(file => file.path === `runtime/${name}`);
      assert.equal(packaged?.sha256, createHash('sha256').update(readFileSync(path.join(repo, 'codex', name))).digest('hex'));
    }
    assert.ok(!manifest.some(file => file.path.includes('UPSTREAM_SKILL.md')));
    const verified = spawnSync(python, [verifier, archive, manifestPath], { encoding: 'utf8', timeout: 10000 });
    assert.ifError(verified.error);
    assert.equal(verified.status, 0, verified.stderr);

    const expected = new Map(manifest.map(item => [item.path, item.sha256]));
    const actual = await JSZip.loadAsync(readFileSync(archive));
    const actualFiles = Object.values(actual.files).filter(file => !file.dir);
    assert.equal(actualFiles.length, manifest.length + 1);
    for (const entry of actualFiles) {
      const relative = entry.name.slice(`${packageRoot}/`.length);
      if (relative === 'PACKAGE-MANIFEST.json') {
        assert.deepEqual(await entry.async('nodebuffer'), readFileSync(manifestPath));
        continue;
      }
      assert.ok(expected.has(relative), relative);
      const digest = createHash('sha256').update(await entry.async('nodebuffer')).digest('hex');
      assert.equal(digest, expected.get(relative), relative);
    }

    const unpacked = path.join(scratch, 'unpacked');
    const extracted = spawnSync('/usr/bin/unzip', ['-q', archive, '-d', unpacked], { encoding: 'utf8', timeout: 10000 });
    assert.ifError(extracted.error);
    assert.equal(extracted.status, 0, extracted.stderr);
    const standalone = path.join(scratch, 'installed', packageRoot);
    cpSync(path.join(unpacked, packageRoot, 'skills', packageRoot), standalone, { recursive: true });
    const smoke = spawnSync(process.execPath, ['-e', String.raw`
      const assert = require('node:assert/strict');
      const { createDemo } = require('./scripts/git-demo-server.cjs');
      (async () => {
        const demo = await createDemo();
        try {
          const page = await fetch(demo.url);
          assert.equal(page.status, 200);
          assert.match(await page.text(), /Commit staged/);
          const logo = await fetch(new URL('assets/git-logo.svg', demo.url));
          assert.equal(logo.status, 200);
          assert.match(await logo.text(), /^\s*<svg/);
          assert.equal(demo.receipt().gitStatus, 'MM field-note.txt');
        } finally { await demo.close(); }
      })().catch(error => { console.error(error); process.exitCode = 1; });`,
    ], { cwd: standalone, encoding: 'utf8', timeout: 10000 });
    assert.ifError(smoke.error);
    assert.equal(smoke.status, 0, smoke.stderr);

    const tampered = path.join(scratch, 'tampered.zip');
    const zip = await JSZip.loadAsync(readFileSync(archive));
    zip.file(`${packageRoot}/skills/huashu-design-codex/SKILL.md`, 'tampered entrypoint');
    writeFileSync(tampered, await zip.generateAsync({ type: 'nodebuffer' }));
    const rejected = spawnSync(python, [verifier, tampered, manifestPath], { encoding: 'utf8', timeout: 10000 });
    assert.ifError(rejected.error);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /SHA-256 mismatch/);

    const unsafe = path.join(scratch, 'unsafe.zip');
    const unsafeZip = new JSZip();
    unsafeZip.file(`${packageRoot}/../outside.txt`, 'escape');
    writeFileSync(unsafe, await unsafeZip.generateAsync({ type: 'nodebuffer' }));
    const rejectedPath = spawnSync(python, [verifier, unsafe, manifestPath], { encoding: 'utf8', timeout: 10000 });
    assert.ifError(rejectedPath.error);
    assert.equal(rejectedPath.status, 1);
    assert.match(rejectedPath.stderr, /unsafe archive path|path outside package root/);

    const symlinkManifest = path.join(scratch, 'symlink-manifest.json');
    const symlinkZip = path.join(scratch, 'symlink.zip');
    const symlink = new JSZip();
    symlink.file(`${packageRoot}/one.txt`, 'target');
    symlink.file(`${packageRoot}/alias.txt`, 'one.txt', { unixPermissions: 0o120777 });
    writeFileSync(symlinkZip, await symlink.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }));
    writeFileSync(symlinkManifest, JSON.stringify([
      { path: 'one.txt', sha256: createHash('sha256').update('target').digest('hex') },
      { path: 'alias.txt', sha256: createHash('sha256').update('one.txt').digest('hex') },
    ]));
    const rejectedLink = spawnSync(python, [verifier, symlinkZip, symlinkManifest], { encoding: 'utf8', timeout: 10000 });
    assert.ifError(rejectedLink.error);
    assert.equal(rejectedLink.status, 1);
    assert.match(rejectedLink.stderr, /symbolic link entry/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
