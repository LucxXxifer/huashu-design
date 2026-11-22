const fs = require('node:fs');
const path = require('node:path');
const { Problem, dependency, check, size, localFile } = require('./runtime.cjs');

const origin = 'https://huashu.test';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chromiums = [process.env.HUASHU_CHROMIUM, chrome, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/opt/google/chrome/chrome'];
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.avif':'image/avif', '.gif':'image/gif', '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf', '.mp3':'audio/mpeg', '.wav':'audio/wav', '.mp4':'video/mp4' };

async function withBrowser(fn) {
  const { chromium } = dependency('playwright');
  const executablePath = chromiums.find(candidate => candidate && fs.existsSync(candidate)) || null;
  if (!executablePath) throw new Problem('MISSING_DEPENDENCY', 'A local Chromium executable is required; set HUASHU_CHROMIUM to its path.', 'skipped');
  const browser = await chromium.launch({ executablePath, headless: true, chromiumSandbox: process.platform !== 'darwin', timeout: 12000 });
  try { return await fn(browser); } finally { await browser.close(); }
}

async function openPage(browser, job, file, width, height, label, seek = false) {
  localFile(job.root, file);
  check(path.extname(file).toLowerCase() === '.html', 'Expected an HTML entry file.');
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, offline: true, serviceWorkers: 'block', acceptDownloads: false, reducedMotion: seek ? 'no-preference' : 'reduce' });
  const errors = new Set();
  const note = (code, message) => {
    const key = code + '\n' + message;
    if (!errors.has(key)) job.issue(code, message, { view: label });
    errors.add(key);
  };
  try {
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) {
        note('REMOTE_RESOURCE', `Offline resource blocked: ${url.origin}${url.pathname}`);
        return route.abort('blockedbyclient');
      }
      let relative;
      let real;
      try {
        relative = decodeURIComponent(url.pathname).slice(1);
        if (relative.split('/').some(part => part.startsWith('.'))) throw new Error('Hidden path');
        real = localFile(job.root, relative);
        if (real === job.out || real.startsWith(job.out + path.sep)) throw new Error('Output path');
        if (!types[path.extname(real).toLowerCase()] || fs.statSync(real).size > 40 * 1024 * 1024) throw new Error('Unsupported resource');
      } catch {
        if (relative === 'favicon.ico') return route.fulfill({ status: 204 });
        note('MISSING_RESOURCE', `Cannot serve local resource: ${relative || url.pathname}`);
        return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Unavailable local resource' });
      }
      return route.fulfill({ path: real, contentType: types[path.extname(real).toLowerCase()] });
    });
    await context.routeWebSocket('**/*', ws => { note('REMOTE_RESOURCE', 'WebSocket blocked in local rendering.'); ws.close(); });
    if (seek) await context.addInitScript(() => { window.__seekRender = true; window.__recording = true; });
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    page.on('pageerror', error => note('PAGE_ERROR', error.message));
    page.on('console', message => {
      if (message.type() === 'error' && message.text() !== 'Failed to load resource: the server responded with a status of 404 (Not Found)') note('CONSOLE_ERROR', message.text().slice(0, 420));
    });
    const url = `${origin}/${file.split('/').map(encodeURIComponent).join('/')}`;
    await page.goto(url, { waitUntil: 'load', timeout: 12000 });
    await settle(page);
    return { page, context, errors };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function settle(page) {
  await page.waitForFunction(() => document.fonts.status === 'loaded', { timeout: 6000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function measure(page, minimum) {
  return page.evaluate(minFont => {
    const root = document.documentElement;
    const width = Math.max(root.scrollWidth, document.body.scrollWidth);
    const height = Math.max(root.scrollHeight, document.body.scrollHeight);
    const colors = value => {
      if (!/^rgba?\(/.test(value)) return null;
      const channels = value.match(/[\d.]+/g)?.map(Number);
      return channels?.length >= 3 ? [...channels.slice(0, 3), channels[3] ?? 1] : null;
    };
    const composite = (ink, paper) => paper.map((channel, i) => ink[i] * ink[3] + channel * (1 - ink[3]));
    const luminance = rgb => rgb.reduce((total, x, i) => {
      const c = x / 255;
      return total + (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i];
    }, 0);
    const small = [], low = [];
    let contrastUnmeasured = 0;
    for (const element of document.body.querySelectorAll('*')) {
      if (element.closest('svg,script,style,template,canvas') || !element.getClientRects().length) continue;
      const sample = Array.from(element.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').trim();
      if (!sample) continue;
      const style = getComputedStyle(element);
      if (style.visibility !== 'visible') continue;
      const font = parseFloat(style.fontSize);
      let opacity = 1;
      const layers = [];
      let complex = false, covered = false;
      for (let parent = element; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent);
        opacity *= Number(css.opacity);
        if (covered) continue;
        const color = colors(css.backgroundColor);
        if (!color || css.backgroundImage !== 'none' || css.mixBlendMode !== 'normal') complex = true;
        if (color) layers.push(color);
        covered = color?.[3] === 1;
      }
      if (!opacity) continue;
      const snippet = sample.slice(0, 90);
      if (font < minFont && small.length < 12) small.push({ text: snippet, px: font });
      const ink = colors(style.color);
      if (complex || opacity !== 1 || !ink) { contrastUnmeasured++; continue; }
      const background = layers.reverse().reduce((paper, layer) => composite(layer, paper), [255, 255, 255]);
      const levels = [luminance(background), luminance(composite(ink, background))].sort((a, b) => a - b);
      const ratio = (levels[1] + 0.05) / (levels[0] + 0.05);
      const required = font >= 24 || (font >= 18.66 && Number(style.fontWeight) >= 700) ? 3 : 4.5;
      if (ratio < required && low.length < 12) low.push({ text: snippet, ratio: Number(ratio.toFixed(2)), required });
    }
    const broken = Array.from(document.images).filter(img => img.getClientRects().length && img.complete && img.naturalWidth === 0 && (img.src || img.srcset)).map(img => img.getAttribute('src') || img.getAttribute('srcset')).slice(0, 12);
    return { scrollWidth: width, scrollHeight: height, small, low, contrastUnmeasured, broken };
  }, minimum);
}

async function web(job) {
  const { config, report, issue, publish } = job;
  const dimensions = config.viewports ?? [[1440, 900], [375, 812]];
  const steps = config.steps ?? [];
  const minFont = config.minFontPx ?? 12;
  check(Array.isArray(dimensions) && dimensions.length && dimensions.length <= 8, 'Supply one to eight viewports.');
  dimensions.forEach(view => size(view, 4096));
  check(Array.isArray(steps) && steps.length <= 20 && Number.isFinite(minFont) && minFont >= 8 && minFont <= 40, 'Invalid interaction or typography options.');
  report.checks.viewports = [];
  await withBrowser(async browser => {
    report.checks.browser = browser.version();
    for (const [index, [width, height]] of dimensions.entries()) {
      const label = `view-${index + 1}-${width}x${height}`;
      const { page, context } = await openPage(browser, job, config.file, width, height, label);
      const measured = { width, height, interactions: 0, states: [] };
      report.checks.viewports.push(measured);
      try {
        async function inspect(state, takeScreenshot) {
          await settle(page);
          const data = await measure(page, minFont);
          const detail = { view: label, state };
          measured.states.push({ state, ...data });
          if (data.scrollWidth > width + 1) issue('HORIZONTAL_OVERFLOW', `${data.scrollWidth}px exceeds ${width}px.`, detail);
          if (data.small.length) issue('SMALL_TEXT', `Text below ${minFont}px.`, detail);
          if (data.low.length) issue('LOW_CONTRAST', 'Solid text/background pairs below the minimum contrast.', detail);
          if (data.broken.length) issue('BROKEN_IMAGE', 'Visible images could not be decoded.', detail);
          check(data.scrollHeight < 24001, 'Page exceeds the screenshot height limit; inspect it in explicit sections.', 'CAPTURE_LIMIT');
          if (takeScreenshot) publish(`${label}-${state}.png`, await page.screenshot({ fullPage: true, timeout: 12000 }));
        }
        await inspect('initial', true);
        for (const [stepIndex, step] of steps.entries()) {
          try {
            check(step && typeof step === 'object', 'Invalid interaction step.');
            const commands = ['click', 'fill', 'press', 'expect', 'reload'].filter(key => Object.hasOwn(step, key));
            check(commands.length === 1, 'Specify exactly one interaction per step.');
            switch (commands[0]) {
              case 'click': await page.locator(step.click).click(); break;
              case 'fill': await page.locator(step.fill).fill(step.value); break;
              case 'press': await page.locator(step.press).press(step.key); break;
              case 'reload': check(step.reload === true, 'reload must be true.'); await page.reload({ waitUntil: 'load' }); break;
              case 'expect': {
                const locator = page.locator(step.expect);
                await locator.waitFor({ state: 'visible' });
                if (step.text !== undefined) check((await locator.innerText()).includes(step.text), `Expected visible text: ${step.text}`, 'INTERACTION');
                if (step.value !== undefined) check(await locator.inputValue() === step.value, 'Expected input value differs.', 'INTERACTION');
                if (step.attribute !== undefined) check(await locator.getAttribute(step.attribute) === step.equals, 'Expected attribute differs.', 'INTERACTION');
                break;
              }
            }
            measured.interactions++;
            if (step.screenshot || step.expect !== undefined) await inspect(`step-${stepIndex + 1}`, Boolean(step.screenshot));
          } catch (error) {
            issue('INTERACTION', error.message.slice(0, 500), { view: label, step: stepIndex + 1 });
            break;
          }
        }
      } finally { await context.close(); }
    }
  });
}

module.exports = { web, withBrowser, openPage, settle };
