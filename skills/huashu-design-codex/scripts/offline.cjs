const fs = require('node:fs');
const path = require('node:path');
const { Problem, check, dependency, localFile, scratch, size } = require('./runtime.cjs');
const { withBrowser, openPage, rendered } = require('./browser.cjs');
const { rewriteDocument, unresolved } = require('./html.cjs');

async function measurePage(page) {
  const hasContent = await rendered(page);
  const content = await page.evaluate(() => ({
    brokenImages: [...document.images].filter(image => image.getClientRects().length && image.complete && !image.naturalWidth).length,
    bodyText: document.body.innerText,
  }));
  return { rendered: hasContent, ...content };
}

async function screenshotDifference(original, converted) {
  const sharp = dependency('sharp');
  const sampledSize = [128, 80];
  const pixels = buffer => sharp(buffer).resize(...sampledSize, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const [first, second] = await Promise.all([pixels(original), pixels(converted)]);
  const distance = first.reduce((total, channel, index) => total + Math.abs(channel - second[index]), 0);
  return { meanChannelDifference: distance / first.length / 255, threshold: 0.012, sampledSize };
}

async function offline({ config, root, out, report, issue, publish }) {
  const sourcePath = localFile(root, config.file);
  check(path.extname(sourcePath).toLowerCase() === '.html', 'Expected an HTML entry file.');
  const viewport = size(config.viewport || [1440, 900], 4096);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const preview = { reopenedWithoutExternalRequests: false, remainingExternal: [], brokenImages: null, browserErrors: [], visualComparison: null };
  report.checks.offline = preview;
  let html;
  try {
    html = rewriteDocument(source, root, config.file);
    preview.remainingExternal = unresolved(html);
  } catch (error) {
    if (error instanceof Problem && error.status === 'skipped') throw error;
    preview.remainingExternal = unresolved(source);
    issue(error.code || 'OFFLINE_CONVERSION', error.message);
    return;
  }
  if (preview.remainingExternal.length) {
    issue('OFFLINE_EXTERNAL_RESOURCE', 'Some remote resources remain; the output is not self-contained.', { urls: preview.remainingExternal });
    return;
  }

  const pageJob = scopedRoot => ({ root: scopedRoot, out, issue: () => {} });
  await withBrowser(async browser => {
    const sourcePreview = rewriteDocument(source, root, config.file, { embedAssets: false });
    const original = await openPage(browser, pageJob(root), config.file, ...viewport, 'offline-source', false, 1, sourcePreview);
    let originalShot;
    try {
      const originalContent = await measurePage(original.page);
      check(originalContent.rendered, 'The source preview did not render visible text or media.', 'OFFLINE_EMPTY');
      if (original.errors.size) {
        issue('OFFLINE_SOURCE_RENDER', 'The source preview raised errors before comparison.', { errors: [...original.errors].slice(0, 5) });
        return;
      }
      originalShot = await original.page.screenshot({ timeout: 12000 });
    } finally { await original.context.close(); }

    await scratch(out, async folder => {
      // Reopen with only the delivered file. The job folder could hide a
      // leftover reference to a local image, stylesheet or script.
      const isolatedName = path.basename(config.file);
      fs.writeFileSync(path.join(folder, isolatedName), html);
      const converted = await openPage(browser, { root: fs.realpathSync(folder), issue: () => {} }, isolatedName, ...viewport, 'offline-output', false, 1, html);
      try {
        const content = await measurePage(converted.page);
        Object.assign(preview, {
          reopenedWithoutExternalRequests: converted.networkErrors.size === 0,
          brokenImages: content.brokenImages,
          browserErrors: [...converted.errors],
          bodyText: content.bodyText.slice(0, 500),
          isolatedFileCount: 1,
        });
        if (!preview.reopenedWithoutExternalRequests) issue('OFFLINE_REOPEN', 'The converted file made blocked external requests.');
        if (preview.browserErrors.length) issue('OFFLINE_RENDER', 'The converted page raised errors when reopened.', { errors: preview.browserErrors.slice(0, 5) });
        if (!content.rendered) issue('OFFLINE_EMPTY', 'The converted page did not render visible text or media.');
        if (preview.brokenImages) issue('OFFLINE_IMAGE', 'The converted file contains an image that did not render.');
        if (config.expectText && !content.bodyText.includes(config.expectText)) issue('OFFLINE_CONTENT', `Converted page does not contain expected text: ${config.expectText}.`);
        const image = await converted.page.screenshot({ timeout: 12000 });
        preview.visualComparison = await screenshotDifference(originalShot, image);
        if (preview.visualComparison.meanChannelDifference > preview.visualComparison.threshold) issue('OFFLINE_VISUAL_DIFF', 'The converted page differs materially from its source preview.', { difference: preview.visualComparison.meanChannelDifference });
      } finally { await converted.context.close(); }
    });
  });
  if (report.status === 'passed') publish(`${path.basename(config.file, path.extname(config.file))}.offline.html`, html);
}

module.exports = { offline };
