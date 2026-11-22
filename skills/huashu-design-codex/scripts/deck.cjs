const fs = require('node:fs');
const path = require('node:path');
const { Problem, dependency, check, size, localFile, tool, scratch, hasText } = require('./runtime.cjs');
const { withBrowser, openPage } = require('./browser.cjs');

async function deck(job) {
  const { config, report, issue, publish, out } = job;
  const [width, height] = size(config.size ?? [1280, 720], 3840);
  const slides = config.slides;
  check(Array.isArray(slides) && slides.length > 0 && slides.length <= 60 && slides.every(s => s && typeof s.file === 'string' && Array.isArray(s.text) && s.text.every(t => typeof t === 'string' && t.trim())), 'Supply slides with file and an explicit text array.');
  const mode = config.pptx ?? (slides.some(slide => slide.native) ? 'native' : 'none');
  check(['none', 'native', 'raster'].includes(mode), 'pptx must be none, native or raster.');
  const { PDFDocument } = dependency('pdf-lib');
  Object.assign(report.checks, { pagesExpected: slides.length, pagesInspected: 0, size: [width, height], slides: [] });
  await scratch(out, async temp => {
    const render = await PDFDocument.create();
    const images = [];
    await withBrowser(async browser => {
      for (const [index, spec] of slides.entries()) {
        const name = `slide-${String(index + 1).padStart(2, '0')}`;
        const result = { slide: index + 1, file: spec.file, rendered: false };
        report.checks.slides.push(result);
        let tab;
        try {
          tab = await openPage(browser, job, spec.file, width, height, name);
          await tab.page.emulateMedia({ media: 'screen' });
          const text = await tab.page.locator('body').innerText();
          const missing = spec.text.filter(t => !hasText(text, t));
          check(missing.length === 0, `Missing visible text: ${missing.join(', ')}`, 'HTML_CONTENT');
          const geometry = await tab.page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]);
          check(geometry[0] <= width + 1 && geometry[1] <= height + 1, `Slide content exceeds ${width}×${height}: ${geometry.join('×')}.`, 'SLIDE_OVERFLOW');
          const shot = await tab.page.screenshot({ timeout: 12000 });
          const bytes = await tab.page.pdf({ width: `${width}px`, height: `${height}px`, printBackground: true, displayHeaderFooter: false, timeout: 15000 });
          const one = await PDFDocument.load(bytes);
          check(one.getPageCount() === 1, `HTML produced ${one.getPageCount()} print pages.`, 'PAGE_COUNT');
          const printed = one.getPage(0).getSize();
          check(Math.abs(printed.width - width * .75) < 1.5 && Math.abs(printed.height - height * .75) < 1.5, 'Unexpected PDF page size.', 'PAGE_SIZE');
          check(tab.errors.size === 0, 'Browser reported one or more errors.', 'PAGE_RENDER');
          const [page] = await render.copyPages(one, [0]);
          render.addPage(page);
          images.push(shot);
          result.rendered = true;
          report.checks.pagesInspected++;
          publish(`${name}.png`, shot);
        } catch (error) {
          issue(error instanceof Problem ? error.code : 'PAGE_RENDER', error.message.slice(0, 500), { slide: index + 1 });
        } finally { await tab?.context.close(); }
      }
    });
    if (report.checks.pagesInspected !== slides.length) {
      report.status = report.checks.pagesInspected ? 'partial' : 'failed';
      return;
    }

    const pdfPath = path.join(temp, 'candidate.pdf');
    const pdf = Buffer.from(await render.save());
    fs.writeFileSync(pdfPath, pdf);
    const reopened = await PDFDocument.load(fs.readFileSync(pdfPath));
    check(reopened.getPageCount() === slides.length, 'Combined PDF page count differs.', 'PAGE_COUNT');
    let pdfOK = true;
    for (const [index, spec] of slides.entries()) {
      const page = String(index + 1);
      const result = tool(process.env.HUASHU_PDFTOTEXT || 'pdftotext', ['-f', page, '-l', page, '-layout', pdfPath, '-'], { timeout: 12000, code: 'PDF_READ' });
      const missing = spec.text.filter(text => !hasText(result.stdout, text));
      report.checks.slides[index].pdfMissingText = missing;
      if (missing.length) { pdfOK = false; issue('PDF_CONTENT', `PDF missing text: ${missing.join(', ')}`, { slide: index + 1 }); }
    }
    report.checks.pdf = { pages: reopened.getPageCount(), textVerified: pdfOK };
    if (!pdfOK) return;
    publish('deck.pdf', pdf);
    if (mode === 'none') return;

    try {
      const candidate = await pptxCandidate(job, slides, width, height, images, mode);
      const native = await inspectPptx(candidate, slides, mode);
      report.checks.pptx = { mode, pages: native.length, slides: native, verified: native.every(page => !page.missing.length && page.countMatches) };
      for (const [index, record] of native.entries()) {
        if (record.missing.length || !record.countMatches) issue('PPTX_CONTENT', `Slide ${index + 1}: ${record.missing.length ? `missing editable text: ${record.missing.join(', ')}` : 'native object count differs'}.`, { slide: index + 1 });
      }
      if (!report.checks.pptx.verified) { report.status = 'partial'; return; }
      publish('deck.pptx', candidate);
    } catch (error) {
      issue(error instanceof Problem ? error.code : 'PPTX_EXPORT', error.message.slice(0, 500));
      report.status = 'partial';
    }
  });
}

const inch = px => px / 96;
const validColor = value => typeof value === 'string' && /^#?[a-f\d]{6}$/i.test(value);
function color(value) { check(validColor(value), `Invalid RGB color: ${value}`); return value.replace('#', ''); }

async function pptxCandidate(job, specs, width, height, images, mode) {
  const Pptx = dependency('pptxgenjs');
  const deck = new Pptx();
  deck.defineLayout({ name: 'AUTHORED', width: inch(width), height: inch(height) });
  deck.layout = 'AUTHORED';
  deck.title = job.config.title || 'Design deck';
  for (const [index, spec] of specs.entries()) {
    const page = deck.addSlide();
    if (mode === 'raster') {
      page.addImage({ data: `image/png;base64,${images[index].toString('base64')}`, x: 0, y: 0, w: inch(width), h: inch(height) });
      continue;
    }
    const native = spec.native;
    check(Array.isArray(native?.items) && native.items.length && native.items.length <= 300, `Slide ${index + 1} needs authored native items.`, 'PPTX_CONTENT');
    if (native.background) page.background = { color: color(native.background) };
    for (const item of native.items) {
      const box = item?.box;
      check(Array.isArray(box) && box.length === 4 && box.every(n => Number.isFinite(n) && n >= 0) && box[2] > 0 && box[3] > 0 && box[0] + box[2] <= width + .001 && box[1] + box[3] <= height + .001, `Native item outside slide ${index + 1}.`, 'PPTX_CONTENT');
      const [x, y, w, h] = box.map(inch);
      if (item.type === 'text') {
        check(typeof item.value === 'string' && item.value.trim() && Number.isFinite(item.fontSize) && item.fontSize >= 6 && item.fontSize <= 300, 'Native text needs value and a fontSize in px.', 'PPTX_CONTENT');
        page.addText(item.value, { x, y, w, h, fontSize: item.fontSize * .75, fontFace: item.fontFace || 'Arial', color: color(item.color || '1B2220'), bold: Boolean(item.bold), margin: 0, valign: item.valign || 'top', align: item.align || 'left', breakLine: false });
      } else if (item.type === 'rect' || item.type === 'ellipse') {
        page.addShape(deck.ShapeType[item.type], { x, y, w, h, fill: { color: color(item.fill || 'FFFFFF') }, line: item.line ? { color: color(item.line), width: 1 } : { transparency: 100 } });
      } else if (item.type === 'image') {
        const image = localFile(job.root, item.file);
        check(/\.(png|jpe?g)$/i.test(image), 'Native images must be PNG or JPEG.', 'PPTX_CONTENT');
        page.addImage({ path: image, x, y, w, h, altText: item.alt || '' });
      } else throw new Problem('PPTX_CONTENT', `Unsupported native item: ${item.type}`);
    }
  }
  return Buffer.from(await deck.write({ outputType: 'nodebuffer', compression: true }));
}

async function inspectPptx(bytes, specs, mode) {
  const ZIP = dependency('jszip');
  const { xml2js } = dependency('xml-js');
  const archive = await ZIP.loadAsync(bytes);
  const load = async file => {
    const entry = archive.file(file);
    check(entry, `PPTX missing ${file}.`, 'PPTX_CONTENT');
    return xml2js(await entry.async('string'), { compact: false });
  };
  const children = (node, name) => (node?.elements || []).filter(child => child.name === name);
  const get = (node, name) => children(node, name)[0];
  const descend = (node, name) => (node?.elements || []).flatMap(child => [...(child.name === name ? [child] : []), ...descend(child, name)]);
  const presentation = await load('ppt/presentation.xml');
  const ids = descend(presentation, 'p:sldId');
  check(ids.length === specs.length && archive.file(/^ppt\/slides\/slide\d+\.xml$/).length === specs.length, 'PPTX page count differs.', 'PPTX_CONTENT');
  const rels = await load('ppt/_rels/presentation.xml.rels');
  const targets = new Map(descend(rels, 'Relationship').map(({ attributes }) => [attributes.Id, attributes.Target]));
  const results = [];
  for (const [index, id] of ids.entries()) {
    const target = targets.get(id.attributes['r:id']);
    check(/^slides\/slide\d+\.xml$/.test(target || ''), 'Invalid PPTX page reference.', 'PPTX_CONTENT');
    const slide = await load('ppt/' + target);
    const tree = descend(slide, 'p:spTree')[0];
    const shapes = children(tree, 'p:sp');
    const pictures = children(tree, 'p:pic').length;
    const textBoxes = shapes.filter(shape => get(shape, 'p:txBody'));
    const text = textBoxes.map(box => descend(box, 'a:p').map(p => descend(p, 'a:t').map(node => (node.elements || []).map(t => t.text || '').join('')).join('')).join(' ')).join('\n');
    const expected = specs[index].native?.items || [];
    const missing = mode === 'native' ? specs[index].text.filter(t => !hasText(text, t)) : [];
    const countMatches = mode === 'raster' ? pictures === 1 && shapes.length === 0 : (
      textBoxes.length === expected.filter(item => item.type === 'text').length &&
      shapes.length - textBoxes.length === expected.filter(item => item.type === 'rect' || item.type === 'ellipse').length &&
      pictures === expected.filter(item => item.type === 'image').length);
    results.push({ slide: index + 1, editableTextBoxes: textBoxes.length, editableShapes: shapes.length - textBoxes.length, pictures, missing, countMatches });
  }
  return results;
}

module.exports = { deck };
