const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sharp = require('sharp');
const JSZip = require('jszip');
const { test, after } = require('node:test');
const { assertOpaqueWhitePng, assertPassed, cleanup, fixture, repo, run, sandbox, skill } = require('./test-helpers.cjs');

require(path.join(skill, 'tests/git-commit.test.cjs'));
const modules = path.resolve(__dirname, '..', 'node_modules');
const environment = { HUASHU_NODE_MODULES: modules, HUASHU_PDFTOTEXT: process.env.HUASHU_PDFTOTEXT || 'pdftotext' };

after(() => cleanup());

test('renders and pixel-verifies a long PNG split into a continuous set of slices', { timeout: 205000 }, async () => {
  const width = 96, height = 240;
  const bytes = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    bytes[i] = (x * 17 + y * 3) & 255;
    bytes[i + 1] = (y * 11 + x) & 255;
    bytes[i + 2] = (y ^ x) & 255;
    bytes[i + 3] = 255;
  }
  const png = await sharp(bytes, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const job = fixture('image-long', { file: 'long.png', size: [width, height], cuts: [0, 73, 169, height] }, { 'long.png': png });
  const result = await run('images', job, environment);
  assertPassed(result);
  assert.equal(result.report.checks.reconstructsSource, true);
  assert.equal(result.report.checks.slices.length, 3);
  assert.deepEqual(result.report.checks.slices.map(slice => slice.height), [73, 96, 71]);
  const source = await sharp(png).ensureAlpha().raw().toBuffer();
  const parts = [];
  for (const artifact of ['slice-01.png', 'slice-02.png', 'slice-03.png']) {
    const part = fs.readFileSync(path.join(job.output, artifact));
    await assertOpaqueWhitePng(part, sharp);
    parts.push(await sharp(part).ensureAlpha().raw().toBuffer());
  }
  assert.deepEqual(Buffer.concat(parts), source);
});
test('keeps RGB slices free of an alpha channel when opaque PNGs are required', { timeout: 205000 }, async () => {
  const width = 16, height = 12;
  const pixels = Buffer.alloc(width * height * 3, 173);
  const png = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
  assert.equal((await sharp(png).metadata()).hasAlpha, false);
  const job = fixture('image-rgb', { file: 'rgb.png', size: [width, height], cuts: [0, 5, height], requireOpaque: true }, { 'rgb.png': png });
  const result = await run('images', job, environment);
  assertPassed(result);
  const expected = await sharp(png).raw().toBuffer();
  const slices = [];
  for (const artifact of ['slice-01.png', 'slice-02.png']) {
    const part = fs.readFileSync(path.join(job.output, artifact));
    assert.equal((await sharp(part).metadata()).hasAlpha, false);
    slices.push(await sharp(part).raw().toBuffer());
  }
  assert.deepEqual(Buffer.concat(slices), expected);
});

test('renders every slide and reopens both the PDF and native PPTX output', { timeout: 205000 }, async () => {
  const one = '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:960px;height:540px;overflow:hidden;background:#ecf0e8;color:#162622;font:54px Arial;box-sizing:border-box}main{padding:48px}</style><main>Verified deck alpha</main>';
  const two = '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:960px;height:540px;overflow:hidden;background:#dcebe6;color:#172c32;font:54px Arial;box-sizing:border-box}main{padding:48px}</style><main>Verified deck omega</main>';
  const slides = [
    { file: 'slides/01.html', text: ['Verified deck alpha'], native: { background: 'ECF0E8', items: [{ type: 'text', value: 'Verified deck alpha', box: [48, 48, 860, 90], fontSize: 54, color: '162622', bold: true }] } },
    { file: 'slides/02.html', text: ['Verified deck omega'], native: { background: 'DCEBE6', items: [{ type: 'text', value: 'Verified deck omega', box: [48, 48, 860, 90], fontSize: 54, color: '172C32', bold: true }] } },
  ];
  const job = fixture('deck-output', { title: 'Codex reproducible fixture', size: [960, 540], pptx: 'native', slides }, { 'slides/01.html': one, 'slides/02.html': two });
  const result = await run('deck', job, environment);
  assertPassed(result);
  assert.equal(result.report.checks.pagesExpected, 2);
  assert.equal(result.report.checks.pagesInspected, 2);
  assert.equal(result.report.checks.pdf.pages, 2);
  assert.equal(result.report.checks.pdf.textVerified, true);
  assert.equal(result.report.checks.pptx.verified, true);
  const { PDFDocument } = require('pdf-lib');
  const reopened = await PDFDocument.load(fs.readFileSync(path.join(job.output, 'deck.pdf')));
  assert.equal(reopened.getPageCount(), 2);
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(job.output, 'deck.pptx')));
  const pageCount = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
  assert.equal(pageCount, 2);
  for (const file of ['slide1.xml', 'slide2.xml']) {
    const xml = await zip.file(`ppt/slides/${file}`).async('string');
    assert.match(xml, /<a:t>Verified deck (?:alpha|omega)<\/a:t>/);
  }
  await Promise.all(['slide-01.png', 'slide-02.png'].map(name => assertOpaqueWhitePng(fs.readFileSync(path.join(job.output, name)), sharp)));
});

test('renders one short and one long frame-seek video with verified narration and media', { timeout: 205000 }, async () => {
  const tone = (name, seconds) => {
    const file = path.join(sandbox, name);
    const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${name.includes('long') ? 554 : 440}:duration=${seconds}`, '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', '-y', file];
    const made = spawnSync(process.env.HUASHU_FFMPEG || 'ffmpeg', args, { encoding: 'utf8', timeout: 10000 });
    assert.ifError(made.error);
    assert.equal(made.status, 0, made.stderr);
    return fs.readFileSync(file);
  };
  const makeVideo = (name, seconds, width, height, fps) => {
    const cueName = `audio/${name}.wav`;
    const duration = Math.round(seconds * 0.7 * 1000) / 1000;
    const html = `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;font:42px Arial;color:white}body{display:grid;place-items:center;background:#143b46}main{text-align:center}#stamp{display:inline-block;padding:28px;background:#b64532}</style><main><span id="stamp">SEEK STORY</span><p id="time">0.00</p></main><script>window.__ready=true;window.__seek=t=>{document.querySelector('#stamp').style.transform='translateX('+Math.round((t%1)*12)+'px)';document.querySelector('#time').textContent=t.toFixed(2)}</script>`;
    return fixture(name, {
      file: 'timeline.html', width, height, seconds, fps, requireNarration: true, samples: [Math.min(seconds - 0.1, 0.7)],
      tracks: [{ role: 'narration', file: cueName, start: 0.5, end: 0.5 + duration, gain: 0.8 }, { role: 'music', file: 'audio/music.wav', start: 0, end: seconds, gain: 0.12, loop: true }],
    }, { 'timeline.html': html, [cueName]: tone(`${name}-voice.wav`, duration), 'audio/music.wav': tone(`${name}-long-music.wav`, seconds) });
  };
  const short = makeVideo('short-motion', 3, 320, 180, 12);
  const long = makeVideo('long-motion', 61, 160, 90, 2);
  for (const job of [short, long]) {
    const result = await run('video', job, environment);
    assertPassed(result);
    const check = result.report.checks.video;
    assert.equal(check.duration, job.input.includes('short-motion') ? 3 : 61);
    assert.equal(check.soundStreams, 1);
    assert.equal(check.blackIntervals, 0);
    assert.deepEqual(check.replayedSampleFrames, [...new Set([check.sampledFrames[0].frame, check.sampledFrames[Math.floor(check.sampledFrames.length / 2)].frame])]);
    assert.equal(check.sampleFramesRepeatable, true);
    const mp4 = path.join(job.output, 'video.mp4');
    const probe = spawnSync(process.env.HUASHU_FFPROBE || 'ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', mp4], { encoding: 'utf8', timeout: 10000 });
    assert.ifError(probe.error);
    assert.equal(probe.status, 0, probe.stderr);
    const media = JSON.parse(probe.stdout);
    assert.equal(media.streams.filter(stream => stream.codec_type === 'video').length, 1);
    assert.equal(media.streams.filter(stream => stream.codec_type === 'audio').length, 1);
    assert.ok(Math.abs(Number(media.format.duration) - check.duration) < 0.05);
    assert.ok(check.sampledFrames.length >= 3);
    for (const frame of check.sampledFrames) {
      const decoded = path.join(job.output, frame.name);
      assert.ok(fs.statSync(decoded).size > 0);
      const image = await sharp(decoded).metadata();
      assert.equal(image.width, check.width);
      assert.equal(image.height, check.height);
    }
  }
});
