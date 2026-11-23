const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const { test, after } = require('node:test');
const { cleanup, fixture, run, skill } = require('./test-helpers.cjs');

after(() => cleanup());

function screen({ page = 'pages/menu/menu', title = 'Menu', tab = '', home = false, extra = '', extraOuter = '', height = 812, tabs = ['Menu', 'Orders'] } = {}) {
  return `<section data-mp-page="${page}" data-mp-home="${home ? '1' : ''}" data-mp-title="${title}" data-mp-nav="default" data-mp-nav-color="rgb(250, 249, 247)" data-mp-nav-text="black" data-mp-tab="${tab}" data-mp-tabbar-config='${JSON.stringify({ list: tabs, color: '#777777', selectedColor: '#111111', backgroundColor: '#ffffff' })}' style="position:relative;flex:none;width:375px;height:${height}px;overflow:hidden;border-radius:28px;background:#fff;color:#111">${extraOuter}<div data-mp-capsule style="position:absolute;right:7px;top:48px;width:87px;height:32px"></div><main data-mp-scroll style="position:absolute;inset:90px 0 35px;overflow:auto;font:16px Arial">${title}${extra}</main></section>`;
}

function page({ screens, share = '<div data-mp-share style="width:220px;height:176px;background:#ddd"></div>', scale = 1 }) {
  return `<!doctype html><meta charset="utf-8"><title>Neighborhood cafe</title><style>body{margin:0;background:#eee}#board{display:flex;gap:12px;transform:scale(${scale});transform-origin:top left}</style><div id="board">${screens.join('')}</div>${share}`;
}

const reactTags = '<script src="https://unpkg.com/react@18.3.1/umd/react.development.js" integrity="sha384-hD6/rw4ppMLGNu3tX5cjIb+uRZ7UkRJ6BPkLpg4hAu/6onKUg4lLsHAs9EBPT82L" crossorigin="anonymous"></script><script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js" integrity="sha384-u6aeetuaXnQ38mYT8rp6sbXaQe3NL9t+IBXmnYxwkUI2Hw4bsp2Wvmx4yRQF1uAm" crossorigin="anonymous"></script><script src="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js"></script>';

test('exports WeChat screens from a scaled board with mapped tabs, share card, local images, and design tokens', { timeout: 205000 }, async () => {
  const image = await sharp({ create: { width: 24, height: 24, channels: 4, background: '#2364aa' } }).png().toBuffer();
  const html = page({ screens: [screen({ page: 'pages/orders/orders', title: 'Orders', tab: 'Orders', height: 930, extra: '<img src="assets/mark.png" srcset="assets/mark.png 1x" width="24" height="24"><div style="height:875px"></div><div style="height:20px;background:#2364aa">Bottom of order history</div>' }), screen({ tab: 'Menu', home: true, extra: '<div style="width:24px;height:24px;background-image:url(assets/mark.png)"></div>' })], scale: .48 });
  const job = fixture('mini-valid', { file: 'design.html', name: 'Neighborhood cafe' }, { 'design.html': html, 'assets/mark.png': image });
  const result = await run('mini', job);
  assert.equal(result.code, 0, JSON.stringify(result.report));
  assert.equal(result.report.status, 'passed', JSON.stringify(result.report));
  const manifest = result.report.checks.miniProgram;
  assert.equal(manifest.pages.length, 2);
  assert.deepEqual(manifest.appJson.pages, ['pages/menu/menu', 'pages/orders/orders']);
  assert.deepEqual(manifest.pages.map(item => item.path), ['pages/menu/menu', 'pages/orders/orders']);
  assert.equal(manifest.appJson.window.navigationBarBackgroundColor, '#faf9f7');
  assert.deepEqual(manifest.pages[0].tabs, ['Menu', 'Orders']);
  assert.deepEqual(manifest.shareCards.map(card => card.ratio), ['5:4']);
  assert.ok(manifest.tokens.colors.length);
  for (const file of ['screens/01-menu-menu.png', 'screens/02-orders-orders.png', 'screens/02-orders-orders-long.png', 'share-01.png', 'tokens.json', 'app.json', '給WorkBuddy的話.md', '設計稿.html']) {
    assert.ok(fs.existsSync(path.join(job.output, file)), `missing ${file}`);
  }
  for (const name of ['screens/01-menu-menu.png', 'screens/02-orders-orders.png']) {
    assert.equal((await sharp(path.join(job.output, name)).metadata()).width, 750);
  }
  assert.equal((await sharp(path.join(job.output, 'screens/01-menu-menu.png')).metadata()).height, 1624);
  assert.equal((await sharp(path.join(job.output, 'screens/02-orders-orders.png')).metadata()).height, 1860);
  assert.ok((await sharp(path.join(job.output, 'screens/02-orders-orders-long.png')).metadata()).height > 1624);
  const longShot = await sharp(path.join(job.output, 'screens/02-orders-orders-long.png')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let belowFoldBlue = 0;
  for (let y = 1624; y < longShot.info.height; y++) for (let x = 0; x < longShot.info.width; x++) {
    const offset = (y * longShot.info.width + x) * longShot.info.channels;
    if (longShot.data[offset] === 35 && longShot.data[offset + 1] === 100 && longShot.data[offset + 2] === 170) belowFoldBlue++;
  }
  assert.ok(belowFoldBlue > 100, 'long screenshot must include the fixture marker below the first screen');
  assert.equal(manifest.images.filter(asset => asset.file).length, 1);
  assert.deepEqual(manifest.pages.map(item => item.images), [[manifest.images[0].file], [manifest.images[0].file]]);
  assert.equal(fs.readFileSync(path.join(job.output, manifest.images[0].file)).equals(image), true);
  assert.ok(manifest.tokens.fontSizes.some(item => item.px === 16 && item.rpx === 32));
  assert.equal(manifest.preview.reopenedWithoutExternalRequests, true);
  const readme = fs.readFileSync(path.join(job.output, 'README.md'), 'utf8');
  assert.match(readme, /24\s*[×x]\s*24/);
  assert.ok(readme.includes(`${image.length} bytes`));
  const handoff = fs.readFileSync(path.join(job.output, '設計稿.html'));
  assert.equal(handoff.equals(Buffer.from(html)), true, 'the delivered source remains unchanged and stays separate from exported assets');
});

test('reports capsule overlap, unmapped tab, invalid tab count, and wrong share ratio', { timeout: 205000 }, async () => {
  const html = page({ screens: [screen({ tab: 'Menu', tabs: ['Orders'], extraOuter: '<button style="position:absolute;right:7px;top:48px;width:87px;height:32px">tap</button>' })], share: '<div data-mp-share style="width:200px;height:100px"></div>', scale: .65 });
  const job = fixture('mini-invalid', { file: 'design.html' }, { 'design.html': html });
  const result = await run('mini', job);
  assert.equal(result.code, 1);
  const findings = result.report.checks.miniProgram.findings;
  assert.ok(findings.some(finding => finding.code === 'CAPSULE_OVERLAP'));
  assert.ok(findings.some(finding => finding.code === 'TAB_COUNT'));
  assert.ok(findings.some(finding => finding.code === 'TAB_PAGE_MISSING'));
  assert.ok(findings.some(finding => finding.code === 'SHARE_RATIO'));
});

test('refuses a mini-program without page markers and reports a missing share card separately', async () => {
  const noPages = await run('mini', fixture('mini-no-pages', { file: 'design.html' }, { 'design.html': '<h1>No screen</h1>' }));
  assert.equal(noPages.code, 1);
  assert.ok(noPages.report.issues.some(issue => issue.code === 'MINI_SCREENS'));
  const html = page({ screens: [screen({ tab: '', tabs: undefined }).replace(/ data-mp-tabbar-config='[^']*'/, '')], share: '' });
  const noShare = await run('mini', fixture('mini-no-share', { file: 'design.html' }, { 'design.html': html }));
  assert.equal(noShare.code, 0, JSON.stringify(noShare.report));
  assert.ok(noShare.report.issues.some(issue => issue.code === 'SHARE_MISSING' && issue.severity === 'warning'));
});

test('runs the real WeChat JSX frame through mini and preserves custom tabs, alternative states and font samples', async () => {
  const html = `<!doctype html><meta charset="utf-8">${reactTags}<script type="text/babel" src="wechat_frame.jsx"></script><div id="root"></div><script type="text/babel">
    function CustomBar(){return <div data-mp-tabbar="custom">Score and history</div>}
    ReactDOM.createRoot(document.querySelector('#root')).render(<div style={{display:'flex',gap:12}}>
      <WechatFrame page="pages/score/score" title="Score" tab="Score" home nav="default"><p style={{fontFamily:'\"Design Family\", Arial'}}>Opening score</p><CustomBar/></WechatFrame>
      <WechatFrame page="pages/log/log" title="Log" tab="Log" nav="custom"><div style={{paddingTop:90}}>Log</div><CustomBar/></WechatFrame>
      <WechatFrame page="pages/log/log" title="Empty log" tab="Log" nav="custom"><div style={{paddingTop:90}}>No entries</div><CustomBar/></WechatFrame>
      <WechatShareCard appName="Score" title="A game score"><span>Score card</span></WechatShareCard>
    </div>);
  </script>`;
  const job = fixture('mini-react', { file: 'board.html' }, { 'board.html': html, 'wechat_frame.jsx': fs.readFileSync(path.join(skill, 'assets/wechat_frame.jsx')) });
  const result = await run('mini', job);
  assert.equal(result.code, 0, JSON.stringify(result.report));
  const handoff = result.report.checks.miniProgram;
  assert.deepEqual(handoff.appJson.pages, ['pages/score/score', 'pages/log/log']);
  assert.deepEqual(handoff.appJson.tabBar, { custom: true, list: [{ text: 'Score', pagePath: 'pages/score/score' }, { text: 'Log', pagePath: 'pages/log/log' }] });
  assert.equal(handoff.appJson.window.navigationStyle, undefined);
  assert.equal(handoff.pages[1].nav, 'custom');
  assert.equal(new Set(handoff.pages.map(item => item.screenshot)).size, 3);
  assert.ok(handoff.tokens.fonts.some(font => font.family === 'Design Family' && font.used.includes('Opening score')));
  const readme = fs.readFileSync(path.join(job.output, 'README.md'), 'utf8');
  assert.match(readme, /^# board · 微信小程序設計交接/);
  assert.match(readme, /wx\.loadFontFace/);
  assert.match(readme, /子集/);
  assert.match(fs.readFileSync(path.join(job.output, '給WorkBuddy的話.md'), 'utf8'), /「board」/);
});

test('preserves the upstream footer, back action and native tab interaction on the actual exhibition board', async () => {
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0}</style>${reactTags}<script type="text/babel" src="wechat_frame.jsx"></script><script type="text/babel" src="showboard.jsx"></script><div id="root"></div><script type="text/babel">
    const tabs = {list:[{text:'Order'},{text:'History'}]};
    const screens = [
      {label:'Ordering',main:true,node:<WechatFrame page="pages/order/order" title="Order" tab="Order" tabBar={tabs} home back onBack={()=>document.querySelector('#state').textContent='Went back'} onTabChange={text=>document.querySelector('#state').textContent='Tab '+text} footer={<button id="confirm" onClick={()=>document.querySelector('#state').textContent='Confirmed'}>Confirm order</button>}><p id="state">Ready to order</p></WechatFrame>},
      {label:'History',node:<WechatFrame page="pages/history/history" title="History" tab="History" tabBar={tabs}><p>Order history</p></WechatFrame>},
    ];
    ReactDOM.createRoot(document.querySelector('#root')).render(<Showboard title="Cafe board" layout="hero" screens={screens} aside={<WechatShareCard appName="Cafe" title="Your order is ready"><strong>Pickup</strong></WechatShareCard>}/>);
  </script>`;
  const files = { 'design.html': html, 'wechat_frame.jsx': fs.readFileSync(path.join(skill, 'assets/wechat_frame.jsx')), 'showboard.jsx': fs.readFileSync(path.join(skill, 'assets/showboard.jsx')) };
  const job = fixture('mini-exhibition', { file: 'design.html' }, files);
  const result = await run('mini', job);
  assert.equal(result.code, 0, JSON.stringify(result.report));
  assert.deepEqual(result.report.checks.miniProgram.screenshots.map(shot => shot.width), [750, 750]);
  const web = await run('web', fixture('mini-exhibition-clicks', { file: 'design.html', viewports: [[1440, 1024]], minFontPx: 8, steps: [
    { click: '[data-mp-home="1"] [data-mp-footer] button' }, { expect: '#state', text: 'Confirmed' },
    { click: '[data-mp-home="1"] [data-mp-tabbar] span:text-is("History")' }, { expect: '#state', text: 'Tab History' },
    { click: '[data-mp-home="1"] svg[width="12"][height="20"]' }, { expect: '#state', text: 'Went back' },
    { expect: 'text=Your order is ready', text: 'Your order is ready' },
  ] }, files));
  assert.equal(web.report.checks.viewports[0].interactions, 7, JSON.stringify(web.report.issues));
});

test('reports mixed tabs, page conflicts and missing or external images without silently dropping the handoff', async () => {
  const html = page({ scale: .48, screens: [
    screen({ home: true, tab: 'Menu', extra: '<img src="assets/absent.png"><img src="https://example.invalid/sample.png">' }),
    screen({ page: 'pages/orders/orders', home: true, tab: 'Orders', extra: '<div data-mp-tabbar="custom">Local tabs</div>' }).replace(/ data-mp-tabbar-config='[^']*'/, ''),
  ] });
  const result = await run('mini', fixture('mini-mixed', { file: 'index.html' }, { 'index.html': html }));
  assert.equal(result.code, 1);
  const handoff = result.report.checks.miniProgram;
  for (const code of ['TAB_MODE_MIXED', 'PAGE_HOME_CONFLICT', 'IMAGE_MISSING', 'EXTERNAL_IMAGE']) {
    assert.ok(handoff.findings.some(finding => finding.code === code), code);
  }
  assert.equal(handoff.appJson.tabBar, undefined);
  assert.equal(handoff.preview.reopenedWithoutExternalRequests, false);
});

test('refuses to claim an offline conversion while external resources remain', async () => {
  const html = '<!doctype html><meta charset="utf-8"><h1>Offline marker</h1><script src="https://example.invalid/remote.js"></script>';
  const job = fixture('offline-remote', { file: 'index.html' }, { 'index.html': html });
  const result = await run('offline', job, { HUASHU_NODE_MODULES: process.env.HUASHU_NODE_MODULES });
  assert.equal(result.code, 1, JSON.stringify(result.report));
  assert.ok(result.report.checks.offline.remainingExternal.some(url => url.includes('example.invalid/remote.js')));
  assert.equal(result.report.checks.offline.reopenedWithoutExternalRequests, false);
  assert.ok(!fs.existsSync(path.join(job.output, 'index.offline.html')));
});

test('rewrites upstream React development tags and compiles external and inline JSX into a standalone interactive file', { timeout: 205000 }, async () => {
  const image = await sharp({ create: { width: 24, height: 24, channels: 4, background: '#2364aa' } }).png().toBuffer();
  const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="../css/base.css"><style>i{background-image:url('../assets/mark.png')}</style>${reactTags}<div id="root"></div><script type="text/babel" src="../components/view.jsx"></script><script type="text/babel">function Inline(){return <p style={{backgroundImage:"url('../assets/mark.png')"}}>inline JSX compiled</p>} ReactDOM.createRoot(document.querySelector('#root')).render(<main><External/><Inline/><strong>Compiled offline marker</strong><img src="../assets/mark.png" srcSet="../assets/mark.png 1x, ../assets/mark.png 2x" alt="Blue mark"/><button id="count" onClick={()=>document.querySelector('#n').textContent='11'}>Twelve</button><span id="n">12</span><span>{"<\\/ScRiPt>"}</span><span>{"manual.png"}</span></main>);</script>`;
  const job = fixture('offline-local', { file: 'views/index.html', expectText: 'Compiled offline marker', viewport: [1280, 800] }, { 'views/index.html': html, 'components/view.jsx': `function External(){return <i><img src="../assets/mark.png" alt="mark"/>external JSX compiled</i>}`, 'css/base.css': `@import "inner.css"; main{background:url('../assets/mark.png') no-repeat right top}`, 'css/inner.css': 'strong { color:#163d20 }', 'assets/mark.png': image });
  const result = await run('offline', job);
  assert.equal(result.code, 0, JSON.stringify(result.report));
  const output = fs.readFileSync(path.join(job.output, 'index.offline.html'), 'utf8');
  assert.match(output, /Compiled offline marker/);
  assert.doesNotMatch(output, /https:\/\/unpkg\.com|assets\/mark\.png|css\/base\.css/);
  assert.doesNotMatch(output, /text\/babel/);
  assert.equal(result.report.checks.offline.reopenedWithoutExternalRequests, true);
  assert.equal(result.report.checks.offline.isolatedFileCount, 1);
  assert.equal(result.report.checks.offline.browserErrors.length, 0);
  assert.equal(result.report.checks.offline.brokenImages, 0);
  assert.ok(result.report.checks.offline.bodyText.includes('external JSX compiled'));
  assert.ok(result.report.checks.offline.bodyText.includes('inline JSX compiled'));
  assert.ok(result.report.checks.offline.bodyText.includes('manual.png'));
  assert.ok(output.includes('react.production.min.js'), 'expected the production React build');
  assert.ok(output.includes(fs.readFileSync(path.join(skill, 'assets/vendor/LICENSE.react'), 'utf8')), 'expected the full React notice in the standalone HTML');
  assert.ok(result.report.checks.offline.visualComparison.meanChannelDifference <= 0.012);
  const browser = await chromium.launch({ executablePath: process.env.HUASHU_CHROMIUM || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const context = await browser.newContext({ offline: true, serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.goto(pathToFileURL(path.join(job.output, 'index.offline.html')).href);
    await page.locator('#count').click();
    assert.equal(await page.locator('#n').textContent(), '11');
    assert.match(await page.locator('main > img').evaluate(img => img.currentSrc), /^data:image\/png/);
    assert.match(await page.locator('p').evaluate(element => getComputedStyle(element).backgroundImage), /^url\("data:image\/png/);
  } finally { await browser.close(); }
});

test('marks missing static assets and nonrendering output as failed', async () => {
  const missing = await run('offline', fixture('offline-missing', { file: 'index.html' }, { 'index.html': '<h1>Photo</h1><img srcset="missing.png 2x" style="background: url(absent.png)">' }));
  assert.equal(missing.code, 1, JSON.stringify(missing.report));
  assert.ok(missing.report.issues.some(issue => issue.code === 'FILE_MISSING'));
  const blank = await run('offline', fixture('offline-blank', { file: 'index.html' }, { 'index.html': '<div id="root"></div>' }));
  assert.equal(blank.code, 1, JSON.stringify(blank.report));
  assert.ok(blank.report.issues.some(issue => issue.code === 'OFFLINE_EMPTY'));
});

test('refuses external dependencies that cannot be fetched and embedded', async () => {
  const fonts = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora"><h1>Font marker</h1>';
  const external = await run('offline', fixture('offline-fonts', { file: 'index.html' }, { 'index.html': fonts }));
  assert.equal(external.code, 1);
  assert.ok(external.report.checks.offline.remainingExternal.some(url => url.includes('fonts.googleapis.com')));
});

test('package allowlist includes mini-program and offline adapter assets without upstream private runtime switching', () => {
  const packageFiles = fs.readFileSync(path.join(skill, 'scripts/package-files.txt'), 'utf8');
  assert.match(packageFiles, /scripts\/mini\.cjs/);
  assert.match(packageFiles, /scripts\/offline\.cjs/);
  assert.match(packageFiles, /references\/miniprogram\.md/);
  assert.match(packageFiles, /assets\/wechat_frame\.jsx/);
  assert.doesNotMatch(packageFiles, /scripts\/_pyenv\.py/);
});
