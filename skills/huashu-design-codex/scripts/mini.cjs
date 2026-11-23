const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { check, dependency, localFile } = require('./runtime.cjs');
const { withBrowser, openPage } = require('./browser.cjs');

const LOCAL_ORIGIN = 'https://huashu.test';
const slug = value => (value || 'page').split('/').filter(part => part && part !== 'pages').join('-').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 48) || 'page';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const overlap = (a, b, pad = 0) => a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;
const px = value => Number.parseFloat(value) || 0;
const systemFont = family => /^(?:-apple-system|blinkmacsystemfont|system-ui|ui-(?:sans-serif|serif|monospace|rounded)|sans-serif|serif|monospace|Arial|Helvetica(?: Neue)?|PingFang(?: SC| TC| HK)?|SF Pro(?: Text| Display)?|Apple Color Emoji|Hiragino Sans(?: GB)?|Microsoft YaHei|Songti(?: SC| TC)?|STSong|STHeiti|SimSun|Segoe UI|Roboto|Menlo|Courier(?: New)?|Times(?: New Roman)?)$/i.test(family);

function cssHex(value) {
  const channels = value.match(/[\d.]+/g);
  if (!value.startsWith('rgb') || !channels || channels.length < 3) return value;
  return `#${channels.slice(0, 3).map(channel => Math.round(Number(channel)).toString(16).padStart(2, '0')).join('')}`;
}

function tokensFor(screens) {
  const tokens = Object.fromEntries(['colors', 'fontSizes', 'radii', 'fonts'].map(key => [key, Object.create(null)]));
  const samples = new Map();
  for (const screen of screens) for (const { font, text } of screen.texts) {
    if (!font || systemFont(font)) continue;
    if (!samples.has(font)) samples.set(font, new Set());
    if (samples.get(font).size < 60) samples.get(font).add(text);
  }
  for (const screen of screens) for (const style of screen.styles) {
    if (!['svg', 'path', 'circle', 'rect', 'g', 'line'].includes(style.tag)) tokens.fontSizes[style.size] = (tokens.fontSizes[style.size] || 0) + 1;
    tokens.fonts[style.font] = (tokens.fonts[style.font] || 0) + 1;
    if (style.radius !== '0px') tokens.radii[style.radius] = (tokens.radii[style.radius] || 0) + 1;
    for (const color of [style.color, style.background, style.border]) if (color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') tokens.colors[color] = (tokens.colors[color] || 0) + 1;
  }
  const ranked = values => Object.entries(values).sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
  tokens.colors = ranked(tokens.colors).slice(0, 14).map(item => ({ ...item, hex: cssHex(item.value) }));
  tokens.fontSizes = ranked(tokens.fontSizes).slice(0, 10).map(item => ({ ...item, px: px(item.value), rpx: Math.round(px(item.value) * 2) }));
  tokens.radii = ranked(tokens.radii).slice(0, 6).map(item => ({ ...item, px: px(item.value), rpx: Math.round(px(item.value) * 2) }));
  const usedByFamily = ranked(tokens.fonts).map(item => ({ family: item.value, count: item.count, system: systemFont(item.value), used: [...(samples.get(item.value) || [])].sort((a, b) => b.length - a.length).slice(0, 6) }));
  tokens.fonts = usedByFamily.filter((item, index) => index < 6 || !item.system);
  return tokens;
}

function tabPlan(screens) {
  const findings = [];
  const error = (code, message, page) => findings.push({ severity: 'error', code, message, page });
  const native = screens.filter(screen => screen.tabs);
  const custom = screens.filter(screen => screen.customTab);
  const mixed = native.length > 0 && custom.length > 0;
  if (mixed) error('TAB_MODE_MIXED', 'Choose one global mode: native tabBar or custom tabBar.');
  const config = native[0]?.tabs;
  let labels = config?.list ?? [...new Set(custom.map(screen => screen.tab).filter(Boolean))];
  if (!Array.isArray(labels) || !labels.every(label => typeof label === 'string' && label.trim()) || new Set(labels).size !== labels.length) {
    error('TAB_CONFIG', 'Tab labels must be nonempty, unique strings.');
    labels = [];
  }
  if (config && native.some(({ tabs }) => ['list', 'color', 'selectedColor', 'backgroundColor'].some(key => JSON.stringify(tabs[key]) !== JSON.stringify(config[key])))) {
    error('TAB_CONFIG_MISMATCH', 'All native tabBar configurations must match.');
  }
  const mapping = new Map();
  const pageTabs = new Map();
  for (const screen of [...native, ...custom.filter(screen => !screen.tabs)]) {
    if (!screen.tab) {
      if (screen.customTab) error('TAB_CUSTOM_UNMAPPED', 'Name the custom tab on each screen so it can map to a page.', screen.page);
      else findings.push({ severity: 'warning', code: 'TAB_ON_DETAIL', page: screen.page, message: 'A native tabBar is drawn on a screen without a selected tab. Remove it on secondary pages.' });
      continue;
    }
    if (!mixed && !labels.includes(screen.tab)) error('TAB_LABEL', `Tab ${screen.tab} is not in the global tabBar.`, screen.page);
    if ((mapping.has(screen.tab) && mapping.get(screen.tab) !== screen.page) ||
        (pageTabs.has(screen.page) && pageTabs.get(screen.page) !== screen.tab)) error('TAB_PAGE_CONFLICT', 'Each tab must map to one unique page.', screen.page);
    mapping.set(screen.tab, screen.page);
    pageTabs.set(screen.page, screen.tab);
  }
  if (native.length || custom.length) {
    if (labels.length < 2 || labels.length > 5) error('TAB_COUNT', `TabBar has ${labels.length} entries; expected 2–5.`);
    for (const label of labels) if (!mapping.has(label)) error('TAB_PAGE_MISSING', `No screen maps tab ${label}.`);
  }
  let tabBar;
  if ((native.length || custom.length) && !findings.some(item => item.severity === 'error')) {
    const list = labels.map(text => ({ text, pagePath: mapping.get(text) }));
    tabBar = config ? { color: config.color, selectedColor: config.selectedColor, backgroundColor: config.backgroundColor, list } : { custom: true, list };
  }
  return { tabBar, labels, findings };
}

function findingsFor(screens, shares, tabs) {
  const findings = [...tabs.findings];
  if (new Set(screens.filter(screen => screen.home).map(screen => screen.page)).size > 1) {
    findings.push({ severity: 'error', code: 'PAGE_HOME_CONFLICT', message: 'Mark only one unique page as the entry point.' });
  }
  for (const screen of screens) {
    if (typeof screen.page !== 'string' || !/^pages\/[\p{L}\p{N}_-]+\/[\p{L}\p{N}_-]+$/u.test(screen.page)) {
      findings.push({ severity: 'error', code: 'PAGE_PATH', page: screen.page, message: 'Page path must be pages/<name>/<name>.' });
    }
    if (screen.tabConfigInvalid) findings.push({ severity: 'error', code: 'TAB_CONFIG', page: screen.page, message: 'data-mp-tabbar-config is not a valid tab configuration.' });
    if (!screen.tabs && screen.tab && !screen.customTab) {
      findings.push({ severity: 'warning', code: 'TAB_WITHOUT_BAR', page: screen.page, message: 'Screen marks a tab but no native tabBar configuration is present.' });
    }
    if (screen.capsule) {
      if (screen.texts.some(text => overlap(text.rect, screen.capsule, 2))) {
        findings.push({ severity: 'error', code: 'CAPSULE_OVERLAP', page: screen.page, message: 'Text intersects the WeChat capsule.' });
      }
      if (screen.clickables.some(item => overlap(item.rect, screen.capsule, 4))) {
        findings.push({ severity: 'error', code: 'CAPSULE_OVERLAP', page: screen.page, message: 'A clickable item intersects the WeChat capsule.' });
      }
    }
    if (screen.statusBar && screen.clickables.some(item => overlap(item.rect, screen.statusBar))) {
      findings.push({ severity: 'error', code: 'STATUSBAR_TAP', page: screen.page, message: 'A clickable item intersects the status bar.' });
    }
    if (screen.texts.some(text => text.rect.top < 44 && text.rect.bottom > 0)) {
      findings.push({ severity: 'error', code: 'STATUSBAR_OVERLAP', page: screen.page, message: 'Text intersects the status bar.' });
    }
    if (screen.images.some(image => image.statusBarOverlap)) {
      findings.push({ severity: 'warning', code: 'STATUSBAR_IMAGE', page: screen.page, message: 'A small image intersects the status bar.' });
    }
    if (screen.texts.some(text => text.fontSize < 12)) {
      findings.push({ severity: 'warning', code: 'SMALL_TEXT', page: screen.page, message: 'Some text is below the upstream 12 CSS px suggestion.' });
    }
    if (screen.localBackgroundImages.length) {
      findings.push({ severity: 'warning', code: 'LOCAL_BACKGROUND_IMAGE', page: screen.page, message: 'CSS background images need conversion to native mini-program <image> assets.' });
    }
    if (screen.backdropFilter) {
      findings.push({ severity: 'warning', code: 'BACKDROP_FILTER', page: screen.page, message: 'backdrop-filter has inconsistent Android support.' });
    }
  }
  if (!shares.length) findings.push({ severity: 'warning', code: 'SHARE_MISSING', message: 'No WeChat share card was included.' });
  for (const [index, card] of shares.entries()) {
    if (!card.validRatio) findings.push({ severity: 'error', code: 'SHARE_RATIO', message: `Share card ${index + 1} is ${card.width}×${card.height}; expected 5:4.` });
  }
  return findings;
}

function orderedScreens(screens, order) {
  return [...screens].sort((a, b) => Number(b.home) - Number(a.home) ||
    (a.tab && order.includes(a.tab) ? order.indexOf(a.tab) : order.length) -
    (b.tab && order.includes(b.tab) ? order.indexOf(b.tab) : order.length));
}

function appJson(screens, tabBar) {
  const pages = [...new Set(screens.map(screen => screen.page))];
  const first = screens[0];
  const window = { navigationBarTitleText: first?.title || '' };
  if (first?.nav === 'default') {
    window.navigationBarBackgroundColor = cssHex(first.navColor || '#ffffff');
    window.navigationBarTextStyle = first.navText || 'black';
  } else if (screens.every(screen => screen.nav === 'custom')) window.navigationStyle = 'custom';
  const result = { pages, window, lazyCodeLoading: 'requiredComponents' };
  if (tabBar) result.tabBar = tabBar;
  return result;
}

async function mini({ config, root, report, issue, publish, out }) {
  check(typeof config.file === 'string', 'Supply a mini-program design HTML file.');
  check(config.name === undefined || typeof config.name === 'string', 'Expected an optional mini-program name.');
  const file = localFile(root, config.file);
  check(path.extname(file).toLowerCase() === '.html', 'Expected an HTML design file.');
  const findings = [];
  let screens, shares, images, tokens;
  await withBrowser(async browser => {
    const { page, context, errors } = await openPage(browser, { root, out, issue: (code, message) => findings.push({ severity: 'warning', code, message }) }, config.file, 1600, 1200, 'mini-program', false, 2);
    try {
      const ready = await page.waitForFunction(() => document.querySelectorAll('[data-mp-page]').length > 0, { timeout: 8000 }).then(() => true).catch(() => false);
      check(ready, 'No [data-mp-page] screens found; wrap each screen in WechatFrame.', 'MINI_SCREENS');
      const inspected = await page.evaluate(() => {
        const fontFamily = value => value.split(',')[0].replace(/["']/g, '').trim();
        const box = (rect, root, scaleX, scaleY) => ({
          left: (rect.left - root.left) / scaleX,
          top: (rect.top - root.top) / scaleY,
          right: (rect.right - root.left) / scaleX,
          bottom: (rect.bottom - root.top) / scaleY,
        });
        const result = [];
        for (const node of document.querySelectorAll('[data-mp-page]')) {
          const root = node.getBoundingClientRect();
          // A design board commonly scales the 375×812 phone for exhibition.
          // Findings use logical CSS pixels so a 90px content inset does not
          // become a false 43px status-bar overlap after a .48 transform.
          const scaleX = root.width / (node.offsetWidth || root.width) || 1;
          const scaleY = root.height / (node.offsetHeight || root.height) || 1;
          const capsuleNode = node.querySelector('[data-mp-capsule]');
          const visible = rect => rect.width > 1 && rect.height > 1 && rect.bottom > root.top && rect.top < root.bottom && rect.right > root.left && rect.left < root.right;
          const texts = [];
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          let textNode;
          while ((textNode = walker.nextNode())) {
            const text = textNode.textContent.replace(/\s+/g, ' ').trim();
            const parent = textNode.parentElement;
            if (!text || !parent || parent.closest('[data-mp-capsule], [data-mp-chrome], [data-mp-tabbar="native"]')) continue;
            const style = getComputedStyle(parent);
            if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < .05) continue;
            const range = document.createRange(); range.selectNodeContents(textNode);
            for (const rect of range.getClientRects()) if (visible(rect)) texts.push({ text: text.slice(0, 120), rect: box(rect, root, scaleX, scaleY), fontSize: parseFloat(style.fontSize), font: fontFamily(style.fontFamily) });
          }
          const clickables = [...node.querySelectorAll('a,button,input,select,textarea,[role="button"],[onclick]')]
            .filter(el => !el.closest('[data-mp-capsule], [data-mp-tabbar="native"]') && visible(el.getBoundingClientRect()) && getComputedStyle(el).visibility === 'visible')
            .map(el => ({ rect: box(el.getBoundingClientRect(), root, scaleX, scaleY) }));
          const tabNode = node.dataset.mpTabbarConfig;
          let tabs = null;
          if (tabNode) {
            try {
              const parsed = JSON.parse(tabNode);
              if (parsed && Array.isArray(parsed.list)) tabs = parsed;
            } catch { /* Report an invalid configuration below. */ }
          }
          const styles = [node, ...node.querySelectorAll('*')].filter(el => !el.closest('[data-mp-chrome], [data-mp-capsule], [data-mp-tabbar="native"]')).map(el => {
            const css = getComputedStyle(el);
            return { color: css.color, background: css.backgroundColor, border: css.borderTopWidth !== '0px' ? css.borderTopColor : '', size: css.fontSize, radius: css.borderTopLeftRadius, font: fontFamily(css.fontFamily), tag: el.tagName.toLowerCase(), backgroundImage: css.backgroundImage, backdropFilter: css.backdropFilter };
          });
          const imageNodes = [...node.querySelectorAll('img')].map(img => {
            const rect = box(img.getBoundingClientRect(), root, scaleX, scaleY);
            return { src: img.currentSrc || img.src, source: img.getAttribute('src') || img.getAttribute('srcset') || '', width: img.naturalWidth, height: img.naturalHeight, statusBarOverlap: rect.top < 40 && rect.bottom > 8 && rect.right - rect.left < node.offsetWidth * 0.9 };
          });
          const localBackgroundImages = [];
          for (const style of styles) {
            for (const match of style.backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
              const url = new URL(match[1], document.baseURI);
              if (url.origin === location.origin || url.protocol === 'data:') localBackgroundImages.push(url.href);
              imageNodes.push({ src: url.href, source: match[1], width: 0, height: 0 });
            }
          }
          const scrollNode = node.querySelector('[data-mp-scroll]');
          result.push({
            page: node.dataset.mpPage, title: node.dataset.mpTitle || '', home: node.dataset.mpHome === '1',
            nav: node.dataset.mpNav || 'default', navColor: node.dataset.mpNavColor || '#ffffff', navText: node.dataset.mpNavText || 'black',
            tab: node.dataset.mpTab || '', tabs, tabConfigInvalid: Boolean(tabNode && !tabs),
            customTab: node.matches('[data-mp-tabbar="custom"]') || Boolean(node.querySelector('[data-mp-tabbar="custom"]')),
            width: node.offsetWidth, height: node.offsetHeight,
            scrollHeight: scrollNode?.scrollHeight || node.scrollHeight, scrollViewportHeight: scrollNode?.clientHeight || node.clientHeight,
            texts, clickables, statusBar: { left: 0, right: node.offsetWidth, top: 0, bottom: 44 },
            capsule: capsuleNode ? box(capsuleNode.getBoundingClientRect(), root, scaleX, scaleY) : { left: node.offsetWidth - 94, right: node.offsetWidth - 7, top: 48, bottom: 80 },
            images: imageNodes, localBackgroundImages, backdropFilter: styles.some(style => style.backdropFilter && style.backdropFilter !== 'none'), styles,
          });
        }
        const shareCards = [...document.querySelectorAll('[data-mp-share]')].map(node => { const rect = node.getBoundingClientRect(); return { width: rect.width, height: rect.height }; });
        return { screens: result, shares: shareCards };
      });
      const tabs = tabPlan(inspected.screens);
      screens = orderedScreens(inspected.screens, tabs.labels).map(screen => ({ ...screen, originalIndex: inspected.screens.indexOf(screen) }));
      shares = inspected.shares.map(card => ({ ...card, validRatio: card.height > 0 && Math.abs(card.width / card.height - 1.25) <= .03, ratio: card.height ? `${card.width / card.height}` : 'invalid' }));
      findings.push(...findingsFor(screens, shares, tabs));
      images = [];
      const assetMap = new Map();
      const sharp = dependency('sharp');
      for (const screen of screens) {
        const assetNames = [];
        for (const image of screen.images) {
          let bytes, extension, source = image.src || image.source;
          if (!source) continue;
          if (source.startsWith('data:image/')) {
            const match = source.match(/^data:image\/(png|jpeg|gif|webp|avif|svg\+xml);base64,([\s\S]*)$/i);
            if (!match) { findings.push({ severity: 'warning', code: 'IMAGE_DATA_URL', page: screen.page, message: 'Unsupported inline image data URL.' }); continue; }
            const type = match[1].toLowerCase();
            bytes = Buffer.from(match[2], 'base64');
            extension = type === 'jpeg' ? 'jpg' : type === 'svg+xml' ? 'svg' : type;
            source = `embedded ${extension}`;
          } else if (/^https?:/i.test(image.src) && new URL(image.src).origin !== LOCAL_ORIGIN) {
            findings.push({ severity: 'warning', code: 'EXTERNAL_IMAGE', page: screen.page, source: image.src.slice(0, 180), message: 'External image is not copied; add a licensed local asset to the project.' });
            images.push({ url: image.src, page: screen.page });
            continue;
          } else {
            try {
              const pathname = new URL(image.src).pathname;
              const relative = decodeURIComponent(pathname).replace(/^\//, '');
              const assetPath = localFile(root, relative);
              bytes = fs.readFileSync(assetPath);
              extension = path.extname(assetPath).slice(1).toLowerCase();
              source = relative;
            } catch {
              findings.push({ severity: 'warning', code: 'IMAGE_MISSING', page: screen.page, source: image.source, message: 'Image is not a regular local file inside the job directory.' });
              images.push({ missing: image.source, page: screen.page });
              continue;
            }
          }
          const digest = hash(bytes);
          let destination = assetMap.get(digest);
          if (!destination) {
            const metadata = await sharp(bytes).metadata().catch(() => null);
            if (!metadata || !/^(?:png|jpe?g|gif|webp|avif|svg)$/.test(extension)) {
              findings.push({ severity: 'error', code: 'IMAGE_FORMAT', page: screen.page, message: `Cannot export a supported image: ${source}` });
              continue;
            }
            destination = `images/${String(assetMap.size + 1).padStart(2, '0')}-${digest.slice(0, 10)}.${extension}`;
            assetMap.set(digest, destination);
            publish(destination, bytes);
            const sizeKb = Math.round(bytes.length / 1024);
            images.push({ file: destination, source, sizeKb, bytes: bytes.length, width: metadata.width || image.width || null, height: metadata.height || image.height || null });
          }
          if (!assetNames.includes(destination)) assetNames.push(destination);
        }
        screen.exportedImages = assetNames;
      }
      tokens = tokensFor(screens);
      const customFonts = tokens.fonts.filter(font => !font.system);
      if (customFonts.length > 2) findings.push({ severity: 'warning', code: 'MANY_CUSTOM_FONTS', message: 'More than two non-system font families are used.' });
      const imageBytes = images.reduce((total, image) => total + (image.bytes || 0), 0);
      if (imageBytes > 1536 * 1024) findings.push({ severity: 'warning', code: 'MAIN_PACKAGE_BUDGET', message: 'Images exceed 1.5 MiB, leaving little of the 2 MiB reference budget for code and fonts.' });
      const largeImages = images.filter(image => image.bytes > 200 * 1024);
      if (largeImages.length) findings.push({ severity: 'warning', code: 'LARGE_IMAGES', message: `${largeImages.length} exported image(s) exceed 200 KiB; check compression and target display size.` });
      const shots = [];
      for (const [index, screen] of screens.entries()) {
        const locator = page.locator('[data-mp-page]').nth(screen.originalIndex);
        await locator.evaluate(node => {
          const saved = [];
          const set = (element, property, value) => { saved.push([element, property, element.style[property]]); element.style[property] = value; };
          for (let parent = node; parent && parent !== document.documentElement; parent = parent.parentElement) {
            const css = getComputedStyle(parent);
            if (css.transform !== 'none') set(parent, 'transform', 'none');
            if (css.zoom !== '1') set(parent, 'zoom', '1');
            if (css.scale !== 'none') set(parent, 'scale', 'none');
            if (css.translate !== 'none') set(parent, 'translate', 'none');
            if (css.rotate !== 'none') set(parent, 'rotate', 'none');
            if (parent !== node && css.overflow !== 'visible') set(parent, 'overflow', 'visible');
            if (css.borderRadius !== '0px') set(parent, 'borderRadius', '0');
          }
          let branch = node;
          while (branch?.parentElement && branch !== document.body) {
            for (const sibling of branch.parentElement.children) if (sibling !== branch && !['SCRIPT', 'STYLE'].includes(sibling.tagName)) set(sibling, 'visibility', 'hidden');
            branch = branch.parentElement;
          }
          // Playwright rounds capture bounds outward in CSS pixels. Align a
          // fractionally positioned screen before its 2× screenshot.
          const { left, top } = node.getBoundingClientRect();
          const x = left + scrollX, y = top + scrollY;
          set(node, 'translate', `${Math.round(x) - x}px ${Math.round(y) - y}px`);
          window.__codexMiniSaved = saved;
        });
        const name = `screens/${String(index + 1).padStart(2, '0')}-${slug(screen.page)}`;
        try {
          await locator.scrollIntoViewIfNeeded();
          const screenshot = await locator.screenshot({ timeout: 12000 });
          const metadata = await sharp(screenshot).metadata();
          check(metadata.width === 750 && metadata.height === screen.height * 2, `Screen ${screen.page} rendered at ${metadata.width}×${metadata.height}px, expected 750×${screen.height * 2}px at 2x.`, 'MINI_SCREEN_SIZE');
          publish(`${name}.png`, screenshot);
          const item = { page: screen.page, screenshot: `${name}.png`, width: metadata.width, height: metadata.height, images: screen.exportedImages };
          // Extend the frame by the content hidden behind its scroll viewport,
          // not by comparing the content height with the entire phone frame.
          const extraHeight = Math.max(0, screen.scrollHeight - screen.scrollViewportHeight);
          if (extraHeight > 4) {
            await locator.evaluate((node, extra) => {
              const saved = window.__codexMiniSaved || (window.__codexMiniSaved = []);
              saved.push([node, 'height', node.style.height]);
              node.style.height = `${node.offsetHeight + extra}px`;
              const scroll = node.querySelector('[data-mp-scroll]');
              if (scroll) {
                for (const property of ['height', 'bottom', 'overflow']) saved.push([scroll, property, scroll.style[property]]);
                scroll.style.height = `${scroll.scrollHeight}px`;
                scroll.style.bottom = 'auto';
                scroll.style.overflow = 'visible';
              }
            }, extraHeight);
            const long = await locator.screenshot({ timeout: 12000 });
            const longSize = await sharp(long).metadata();
            check(longSize.width === 750 && longSize.height === (screen.height + extraHeight) * 2, `Long screen ${screen.page} did not render at the expected 2× dimensions.`, 'MINI_SCREEN_SIZE');
            item.longScreenshot = `${name}-long.png`;
            item.longHeight = longSize.height;
            publish(item.longScreenshot, long);
          }
          shots.push(item);
        } finally {
          await page.evaluate(() => {
            for (const [element, property, value] of (window.__codexMiniSaved || []).reverse()) element.style[property] = value;
            delete window.__codexMiniSaved;
          });
        }
      }
      for (const [index] of shares.entries()) {
        const bytes = await page.locator('[data-mp-share]').nth(index).screenshot({ timeout: 12000 });
        const filename = `share-${String(index + 1).padStart(2, '0')}.png`;
        publish(filename, bytes);
        shares[index].file = filename;
      }
      const fatal = findings.filter(finding => finding.severity === 'error');
      const app = appJson(screens, tabs.tabBar);
      report.checks.miniProgram = {
        pages: screens.map((screen, index) => ({
          path: screen.page, title: screen.title, home: screen.home, nav: screen.nav, tab: screen.tab || null,
          tabs: screen.tabs?.list || null, width: screen.width, height: screen.height,
          screenshot: shots[index].screenshot, images: screen.exportedImages,
        })),
        shareCards: shares.map(({ width, height, ratio, validRatio, file }) => ({ width, height, ratio: validRatio ? '5:4' : ratio, validRatio, file })),
        images, tokens, appJson: app, findings, screenshots: shots,
        preview: { reopenedWithoutExternalRequests: errors.size === 0, browserErrors: [...errors] },
      };
      publish('tokens.json', JSON.stringify(tokens, null, 2) + '\n');
      publish('app.json', JSON.stringify(app, null, 2) + '\n');
      const name = config.name?.trim() || (await page.title()).trim() || path.parse(file).name;
      const pageRows = screens.map((screen, index) => `| ${index + 1} | \`${screen.page}\` | ${screen.title} | ${screen.nav} | ${screen.tab || '—'} | \`${shots[index].screenshot}\`${shots[index].longScreenshot ? `，\`${shots[index].longScreenshot}\`` : ''} |`);
      const imageRows = images.map(image => `| \`${image.file || image.url || image.missing}\` | ${image.width ?? '—'}×${image.height ?? '—'} | ${image.bytes ?? '外部/缺失'} bytes |`);
      publish('README.md', `# ${name} · 微信小程序設計交接

設計基準 375 CSS px。逐屏以 750 px 截圖，每個輸出像素對應設計稿的 1 rpx。

## 頁面

| # | 頁面路徑 | 標題 | 導覽 | Tab | 截圖 |
|---|---|---|---|---|---|
${pageRows.join('\n')}

## 分享卡

${shares.length ? shares.map(card => `- \`${card.file}\`（${card.width}×${card.height}，${card.validRatio ? '5:4' : '比例不符'}）`).join('\n') : '- 尚未提供 5:4 分享卡。'}

## 素材

| 檔案 | 像素 | 大小 |
|---|---:|---:|
${imageRows.join('\n') || '| 無 | — | — |'}

已匯出圖片共 ${images.reduce((total, image) => total + (image.bytes || 0), 0)} bytes。主包參考上限為 2 MB。外部圖需取得授權後另行備齊。

## 設計 tokens 與字型

從 \`tokens.json\` 讀取顏色、字級、圓角和字型。\`fonts[].used\` 是畫面取樣。若採用自訂字型，先確認授權允許在小程序使用與製作子集，再補齊實際文案、動態內容、數字與標點所需的字元，透過 \`wx.loadFontFace\` 載入。在目標裝置核對載入成功及系統字型的替代效果。

## 體檢

${findings.map(finding => `- ${finding.severity} · ${finding.code} · ${finding.message}`).join('\n') || '- 機械檢查沒有發現問題，仍需逐張檢視截圖與交互。'}

交接涵蓋原型與工程參考。原生實作須另以微信開發者工具及真機驗收。
`);
      publish('給WorkBuddy的話.md', `請依 README.md、app.json、screens/、share-*.png、images/ 及 tokens.json 實作原生微信小程序「${name}」。保留設計稿的頁面順序、尺寸、品牌素材及交互。先核對缺少的資料、登入、雲端介面與產品規則。依 README 處理字型授權、子集及 wx.loadFontFace，並將 _design 交接資料留在程式包外。逐屏比對之後列出差異，提交微信開發者工具與真機的驗收結果。\n`);
      publish('設計稿.html', fs.readFileSync(file));
      if (fatal.length) for (const finding of fatal) issue(finding.code, finding.message, { page: finding.page });
      for (const finding of findings.filter(item => item.severity === 'warning')) issue(finding.code, finding.message, { page: finding.page }, 'warning');
      check(errors.size === 0, 'The offline design preview raised browser errors.', 'BROWSER_ERROR');
    } finally { await context.close(); }
  });
}

module.exports = { mini };
