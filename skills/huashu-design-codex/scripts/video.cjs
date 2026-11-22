const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Problem, check, integer, localFile, tool, scratch } = require('./runtime.cjs');
const { withBrowser, openPage, settle } = require('./browser.cjs');

const hash = data => createHash('sha256').update(data).digest('hex');
const ffmpeg = (...args) => tool(process.env.HUASHU_FFMPEG || 'ffmpeg', ['-nostdin', '-hide_banner', ...args], { timeout: 180000, code: 'FFMPEG' });
const probe = file => JSON.parse(tool(process.env.HUASHU_FFPROBE || 'ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { timeout: 20000, code: 'FFPROBE' }).stdout);

function cues(job, duration) {
  const input = job.config.tracks ?? [];
  check(Array.isArray(input) && input.length <= 64 && input.every(t => t && ['narration', 'music', 'sfx'].includes(t.role)), 'Use a tracks array with narration, music or sfx roles.');
  const required = job.config.requiredAudioRoles || [];
  check(Array.isArray(required) && required.every(role => ['narration', 'music', 'sfx'].includes(role)), 'Invalid required audio role.');
  if (job.config.requireNarration || required.includes('narration')) {
    check(input.some(t => t.role === 'narration'), 'Required narration is missing.', 'MISSING_NARRATION');
  }
  for (const role of required) check(input.some(track => track.role === role), `Required audio role is missing: ${role}.`, 'MISSING_AUDIO');
  let spokenThrough = 0;
  for (const track of input) {
    const { start, end, gain = 1 } = track;
    check(Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= duration + .001, 'Cue interval must fit within the video.', 'INVALID_CUE');
    check(Number.isFinite(gain) && gain > 0 && gain <= 2, 'Audio gain must be in (0,2].', 'INVALID_CUE');
    check(!track.loop || track.role === 'music', 'Only music can be looped.', 'INVALID_CUE');
    if (track.role === 'narration') {
      check(start >= spokenThrough - .001, 'Narration cues must be ordered and cannot overlap.', 'INVALID_CUE_ORDER');
      spokenThrough = end;
    }
  }
  return input.map(track => {
    const file = localFile(job.root, track.file);
    const media = probe(file);
    const stream = media.streams.find(s => s.codec_type === 'audio');
    const seconds = Number(stream?.duration ?? media.format?.duration);
    check(stream && Number.isFinite(seconds) && seconds > 0, `Cue is not decodable audio: ${track.file}.`, 'INVALID_AUDIO');
    const window = track.end - track.start;
    if (track.role === 'narration') {
      check(Math.abs(seconds - window) <= .08, `Narration ${track.file} is ${seconds.toFixed(3)}s for a ${window.toFixed(3)}s cue. Measure audio before locking cues.`, 'INVALID_NARRATION_DURATION');
      const scan = ffmpeg('-i', file, '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-').stderr;
      const peak = scan.match(/max_volume:\s*(-?[\d.]+) dB/);
      check(peak && Number(peak[1]) > -55, `Narration is silent or too quiet to validate: ${track.file}.`, 'SILENT_NARRATION');
    } else if (!track.loop) {
      check(seconds + .08 >= window, `Audio ${track.file} ends before its interval; shorten the cue or loop music explicitly.`, 'INVALID_AUDIO_DURATION');
    }
    return { ...track, file, source: track.file, seconds };
  });
}

async function video(job) {
  const { config, report, issue, publish, out } = job;
  const { width, height, seconds, fps } = config;
  check(integer(width, 2, 3840) && width % 2 === 0 && integer(height, 2, 2160) && height % 2 === 0 &&
    integer(fps, 1, 60) && Number.isFinite(seconds) && seconds > 0, 'Use even video dimensions, fps of 1–60 and a positive duration.');
  const frames = Math.round(seconds * fps);
  check(Math.abs(frames - seconds * fps) < 1e-6 && integer(frames, 1, 15000), 'Duration must align to the frame grid and the frame count limit.');
  const tracks = cues(job, seconds); // Fail on bad audio before launching a browser or creating frames.
  report.checks.audioCues = tracks.map(({ role, source, start, end, seconds }) => ({ role, file: source, start, end, seconds }));
  localFile(job.root, config.file);
  ffmpeg('-version');
  const samples = [0, Math.floor(frames / 2), frames - 1, ...(config.samples ?? []).map(t => {
    check(Number.isFinite(t) && t >= 0 && t < seconds, 'Sample time must be within the video.');
    return Math.min(frames - 1, Math.round(t * fps));
  })];
  check(samples.length <= 19, 'Supply at most 16 extra sample times.');
  for (const t of tracks.filter(t => t.role === 'narration').map(t => t.start)) {
    const frame = Math.min(frames - 1, Math.ceil(t * fps - 1e-8));
    if (samples.length < 32) samples.push(frame);
  }
  const unique = [...new Set(samples)].sort((a, b) => a - b);
  const replayedSampleFrames = [...new Set([unique[0], unique[Math.floor(unique.length / 2)]])];
  await scratch(out, async temp => {
    const stable = new Map();
    await withBrowser(async browser => {
      const { page, context, errors } = await openPage(browser, job, config.file, width, height, 'video', true);
      try {
        try { await page.waitForFunction(() => window.__ready === true && typeof window.__seek === 'function', undefined, { timeout: 8000 }); }
        catch { throw new Problem('SEEK_CONTRACT', 'Page must provide __ready === true and __seek(t) in __seekRender mode.'); }
        const read = async frame => {
          await page.evaluate(t => window.__seek(t), frame / fps);
          await settle(page);
          check(errors.size === 0, 'Browser error while rendering timeline.', 'FRAME_RENDER');
          return page.screenshot({ timeout: 10000 });
        };
        for (let frame = 0; frame < frames; frame++) {
          const bytes = await read(frame);
          fs.writeFileSync(path.join(temp, `frame-${String(frame).padStart(6, '0')}.png`), bytes);
          if (unique.includes(frame)) stable.set(frame, hash(bytes));
        }
        for (const frame of replayedSampleFrames) {
          check(hash(await read(frame)) === stable.get(frame), `Frame ${frame} changes when seeking back to the same time.`, 'NONDETERMINISTIC_FRAME');
        }
      } finally { await context.close(); }
    });
    const candidate = path.join(temp, 'candidate.mp4');
    const encode = ['-v', 'error', '-framerate', String(fps), '-start_number', '0', '-i', path.join(temp, 'frame-%06d.png')];
    for (const track of tracks) {
      if (track.loop) encode.push('-stream_loop', '-1');
      encode.push('-i', track.file);
    }
    if (tracks.length) {
      const chains = tracks.map((track, index) => `[${index + 1}:a:0]aresample=48000,aformat=channel_layouts=stereo,atrim=duration=${(track.end - track.start).toFixed(6)},asetpts=PTS-STARTPTS,volume=${track.gain ?? 1},adelay=${Math.round(track.start * 1000)}:all=1[a${index}]`);
      const inputs = tracks.map((_, index) => `[a${index}]`).join('');
      encode.push('-filter_complex', `${chains.join(';')};${inputs}amix=inputs=${tracks.length}:normalize=0:duration=longest,alimiter=limit=0.93:level=false:latency=true,apad,atrim=duration=${seconds}[mix]`, '-map', '0:v:0', '-map', '[mix]', '-c:a', 'aac', '-b:a', '160k');
    } else encode.push('-map', '0:v:0', '-an');
    ffmpeg(...encode, '-t', String(seconds), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', candidate);
    const media = probe(candidate);
    const picture = media.streams.filter(s => s.codec_type === 'video');
    const sound = media.streams.filter(s => s.codec_type === 'audio');
    const duration = Number(media.format?.duration);
    check(picture.length === 1 && picture[0].width === width && picture[0].height === height && Number(picture[0].nb_frames) === frames && Math.abs(duration - seconds) <= Math.max(.05, 1 / fps), 'Video dimensions, frames or duration differ from the manifest.', 'VIDEO_METADATA');
    check(sound.length === (tracks.length ? 1 : 0) && (!sound.length || Math.abs(Number(sound[0].duration) - seconds) <= .06), 'Wrong audio stream count or duration.', 'AUDIO_METADATA');
    const black = ffmpeg('-i', candidate, '-an', '-vf', `blackdetect=d=${(.5 / fps).toFixed(5)}:pix_th=0.10:pic_th=0.98`, '-f', 'null', '-').stderr.match(/black_start:.*$/gm) || [];
    check(black.length === 0, `Unexpected black frames: ${black.slice(0, 3).join('; ')}`, 'BLACK_FRAMES');
    const decoded = [];
    for (const frame of unique) {
      const name = `frame-${String(frame).padStart(6, '0')}.png`;
      const sample = path.join(temp, `decoded-${name}`);
      ffmpeg('-v', 'error', '-ss', (frame / fps).toFixed(6), '-i', candidate, '-map', '0:v:0', '-frames:v', '1', '-update', '1', sample);
      check(fs.existsSync(sample) && fs.statSync(sample).size > 0, `Cannot decode frame ${frame}.`, 'FRAME_DECODE');
      decoded.push({ frame, seconds: frame / fps, name, sample });
    }
    for (const track of tracks.filter(track => track.role === 'narration')) {
      const loudness = ffmpeg('-ss', String(track.start), '-i', candidate, '-t', String(track.end - track.start), '-vn', '-af', 'volumedetect', '-f', 'null', '-').stderr.match(/max_volume:\s*(-?[\d.]+) dB/);
      check(loudness && Number(loudness[1]) > -55, `Encoded mix is silent at ${track.start}s.`, 'SILENT_MIX');
    }
    report.checks.video = { width, height, frames, fps, duration, soundStreams: sound.length, audioDuration: sound[0] ? Number(sound[0].duration) : null, blackIntervals: black.length, sampledFrames: decoded.map(({ sample, ...info }) => info), replayedSampleFrames, sampleFramesRepeatable: true };
    for (const { name, sample } of decoded) publish(name, fs.readFileSync(sample));
    publish('video.mp4', fs.readFileSync(candidate));
  });
}

module.exports = { video };
