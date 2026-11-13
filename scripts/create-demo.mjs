#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { access, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scenesPath = path.join(root, 'media/demo-scenes.json');
const outPath = path.join(root, 'media/bento-deck-studio-demo.mp4');
const captionsPath = path.join(root, 'media/bento-deck-studio-demo.srt');
const CAPTION_WIDTH = 1800;
const CAPTION_HEIGHT = 156;
const NARRATION_PAUSE_MS = 320;
const NARRATION_RATE = 118;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`${command} exited with code ${code}: ${Buffer.concat(stderr).toString().trim()}`));
      else resolve(Buffer.concat(stdout).toString().trim());
    });
  });
}

function timestamp(seconds) {
  const ms = Math.round(seconds * 1000);
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

function sentences(text) {
  return text.match(/[^.!?]+[.!?]+/g)?.map((sentence) => sentence.trim()) ?? [text];
}

function addNarrationPauses(text) {
  return text.replace(/([.!?])(?=\s+\S)/g, `$1[[slnc ${NARRATION_PAUSE_MS}]]`);
}

function escapeXml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[char]);
}

function wrapCaption(text) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > 78 && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function captionSvg(text) {
  const lines = wrapCaption(text);
  const lineHeight = 38;
  const top = Math.round((CAPTION_HEIGHT - (lines.length - 1) * lineHeight) / 2);
  const textNodes = lines.map((line, index) =>
    `<text x="84" y="${top + index * lineHeight}" fill="#F2F0EA" font-family="Arial, sans-serif" font-size="29" font-weight="600">${escapeXml(line)}</text>`
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CAPTION_WIDTH}" height="${CAPTION_HEIGHT}" viewBox="0 0 ${CAPTION_WIDTH} ${CAPTION_HEIGHT}"><rect x="2" y="2" width="${CAPTION_WIDTH - 4}" height="${CAPTION_HEIGHT - 4}" rx="22" fill="#101418" fill-opacity=".92" stroke="#5EEC83" stroke-width="2"/><rect x="26" y="28" width="8" height="${CAPTION_HEIGHT - 56}" rx="4" fill="#5EEC83"/>${textNodes}</svg>`;
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('The narrated demo builder uses the macOS en_AU voice. Render on macOS.');
  for (const destination of [outPath, captionsPath]) {
    try {
      await access(destination);
      throw new Error(`Refusing to overwrite an existing demo asset: ${destination}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const scenes = JSON.parse(await readFile(scenesPath, 'utf8'));
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'bento-demo-'));
  try {
    const segments = [];
    for (const [index, scene] of scenes.entries()) {
      const audioPath = path.join(tempDir, `voice-${index + 1}.aiff`);
      await run('say', ['-v', 'Karen', '-r', String(NARRATION_RATE), '-o', audioPath, addNarrationPauses(scene.text)]);
      const duration = Number(await run('ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audioPath
      ]));
      if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Could not read narration duration for scene ${index + 1}.`);
      segments.push({ ...scene, audioPath, duration, videoDuration: duration + 0.35 });
    }

    const total = segments.reduce((sum, segment) => sum + segment.videoDuration, 0);
    if (total < 80 || total > 100) {
      throw new Error(`Narration is ${total.toFixed(1)} seconds; adjust the narration script or voice rate to target about 90 seconds.`);
    }
    const captions = [];
    const captionImages = [];
    let cursor = 0;
    for (const segment of segments) {
      const lines = sentences(segment.text);
      const weights = lines.map((line) => line.split(/\s+/).length);
      const totalWords = weights.reduce((sum, weight) => sum + weight, 0);
      const pauseCount = Math.max(0, lines.length - 1);
      const spokenDuration = segment.duration - pauseCount * NARRATION_PAUSE_MS / 1000;
      let segmentCursor = cursor;
      for (const [index, line] of lines.entries()) {
        const pauseDuration = index < lines.length - 1 ? NARRATION_PAUSE_MS / 1000 : 0;
        const cueDuration = spokenDuration * weights[index] / totalWords + pauseDuration;
        const imageSvg = path.join(tempDir, `caption-${captions.length + 1}.svg`);
        const imagePng = path.join(tempDir, `caption-${captions.length + 1}.png`);
        await writeFile(imageSvg, captionSvg(line));
        await run('sips', ['-s', 'format', 'png', imageSvg, '--out', imagePng]);
        captions.push(`${captions.length + 1}\n${timestamp(segmentCursor)} --> ${timestamp(segmentCursor + cueDuration)}\n${line}\n`);
        captionImages.push({ imagePng, start: segmentCursor, end: segmentCursor + cueDuration });
        segmentCursor += cueDuration;
      }
      cursor += segment.videoDuration;
    }
    const tempCaptionsPath = path.join(tempDir, 'captions.srt');
    const tempVideoPath = path.join(tempDir, 'demo.mp4');
    await writeFile(tempCaptionsPath, `${captions.join('\n').trimEnd()}\n`);

    const args = ['-y'];
    for (const segment of segments) {
      const imagePath = path.resolve(root, 'media', segment.image);
      args.push('-loop', '1', '-framerate', '30', '-t', segment.videoDuration.toFixed(3), '-i', imagePath);
      args.push('-i', segment.audioPath);
    }
    const filters = [];
    for (const [index, segment] of segments.entries()) {
      const imageInput = index * 2;
      const audioInput = imageInput + 1;
      filters.push(`[${imageInput}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,trim=duration=${segment.videoDuration.toFixed(3)},setpts=PTS-STARTPTS[v${index}]`);
      filters.push(`[${audioInput}:a]aresample=48000,apad=pad_dur=0.35,atrim=duration=${segment.videoDuration.toFixed(3)}[a${index}]`);
    }
    const concatInputs = segments.map((_, index) => `[v${index}][a${index}]`).join('');
    filters.push(`${concatInputs}concat=n=${segments.length}:v=1:a=1[video][audio]`);
    const captionInputStart = segments.length * 2;
    captionImages.forEach((caption, index) => {
      const inputIndex = captionInputStart + index;
      args.push('-loop', '1', '-framerate', '30', '-t', total.toFixed(3), '-i', caption.imagePng);
      const previous = index === 0 ? 'video' : `captioned${index - 1}`;
      const output = index === captionImages.length - 1 ? 'captioned' : `captioned${index}`;
      filters.push(`[${previous}][${inputIndex}:v]overlay=(W-w)/2:H-h-54:enable='between(t\\,${caption.start.toFixed(3)}\\,${caption.end.toFixed(3)})'[${output}]`);
    });
    args.push(
      '-filter_complex', filters.join(';'),
      '-map', '[captioned]', '-map', '[audio]',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart',
      '-t', total.toFixed(3), tempVideoPath
    );
    await run('ffmpeg', args);
    await copyFile(tempVideoPath, outPath, constants.COPYFILE_EXCL);
    await copyFile(tempCaptionsPath, captionsPath, constants.COPYFILE_EXCL);
    console.log(`Created ${outPath} (${total.toFixed(1)} seconds) with ${segments.length} narrated scenes.`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Demo video creation failed: ${error.message}`);
  process.exitCode = 1;
});
