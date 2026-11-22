const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { check, dependency, integer, localFile, size } = require('./runtime.cjs');

async function images({ config, root, report, publish }) {
  const dimensions = size(config.size, 20000);
  check(dimensions[0] * dimensions[1] <= 40000000, 'Image exceeds the pixel limit.');
  const files = config.files ?? [config.file];
  check(Array.isArray(files) && files.length > 0 && files.length <= 30 && files.every(file => typeof file === 'string' && file), 'Supply one to thirty image files.');
  if (config.count !== undefined) check(config.count === files.length, 'Image count differs from expected count.', 'IMAGE_COUNT');
  const cuts = config.cuts;
  if (cuts !== undefined) {
    check(files.length === 1 && Array.isArray(cuts) && cuts.length >= 2 && cuts.length <= 31 && cuts[0] === 0 && cuts.at(-1) === dimensions[1] &&
      cuts.every((y, i) => integer(y, 0, dimensions[1]) && (!i || y > cuts[i - 1])), 'Cut rows must increase from 0 through the full height.', 'IMAGE_CUTS');
  }
  const sharp = dependency('sharp');
  const outputs = [];
  report.checks.images = [];
  for (const [index, file] of files.entries()) {
    const bytes = fs.readFileSync(localFile(root, file));
    const image = sharp(bytes, { limitInputPixels: 40000000 });
    const metadata = await image.metadata();
    check(metadata.format === 'png' && metadata.width === dimensions[0] && metadata.height === dimensions[1] && (metadata.pages ?? 1) === 1, `Wrong format or dimensions: ${file}. Expected a single ${dimensions.join('×')} PNG.`, 'IMAGE_SIZE');
    const decoder = image.clone().toColourspace('srgb');
    if (metadata.hasAlpha) decoder.ensureAlpha();
    else decoder.removeAlpha();
    const decoded = await decoder.raw().toBuffer({ resolveWithObject: true });
    const channels = decoded.info.channels;
    check(channels === (metadata.hasAlpha ? 4 : 3), 'Cannot inspect source image channels.', 'IMAGE_READ');
    const pixels = decoded.data;
    let opaque = channels === 3;
    if (channels === 4) {
      opaque = true;
      for (let pos = 3; pos < pixels.length; pos += channels) if (pixels[pos] !== 255) { opaque = false; break; }
    }
    if (config.requireOpaque) check(opaque && !metadata.hasAlpha, `Opaque PNG without an alpha channel required: ${file}.`, 'IMAGE_ALPHA');
    report.checks.images.push({ file, width: metadata.width, height: metadata.height, opaque, alphaChannel: Boolean(metadata.hasAlpha) });
    if (!cuts) { outputs.push([`image-${String(index + 1).padStart(2, '0')}.png`, bytes]); continue; }
    const reconstructed = createHash('sha256');
    report.checks.slices = [];
    for (const [piece, top] of cuts.slice(0, -1).entries()) {
      const height = cuts[piece + 1] - top;
      const raw = pixels.subarray(top * dimensions[0] * channels, (top + height) * dimensions[0] * channels);
      const result = await sharp(raw, { raw: { width: dimensions[0], height, channels } }).png().toBuffer();
      const roundtrip = await sharp(result).raw().toBuffer({ resolveWithObject: true });
      check(roundtrip.info.width === dimensions[0] && roundtrip.info.height === height && roundtrip.data.equals(raw), 'A slice changed its source pixels.', 'IMAGE_SEAM');
      reconstructed.update(roundtrip.data);
      const name = `slice-${String(piece + 1).padStart(2, '0')}.png`;
      report.checks.slices.push({ name, top, height });
      check(Boolean((await sharp(result).metadata()).hasAlpha) === Boolean(metadata.hasAlpha), 'A slice changed its alpha-channel format.', 'IMAGE_CHANNELS');
      outputs.push([name, result]);
    }
    check(reconstructed.digest('hex') === createHash('sha256').update(pixels).digest('hex'), 'Slices do not reconstruct the complete source image.', 'IMAGE_SEAM');
    report.checks.reconstructsSource = true;
  }
  for (const [name, buffer] of outputs) publish(name, buffer);
}

module.exports = { images };
