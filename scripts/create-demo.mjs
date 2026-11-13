#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { access, copyFile, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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
const SAMPLE_RATE = 24000;
// Breathing room between sentences and scenes, in seconds; questions get a longer beat.
const PAUSE = { sentence: 0.38, question: 0.5, scene: 0.65 };
const SAY_RATE = 118;
const TTS_HOME = process.env.BDS_TTS_HOME ?? path.join(os.homedir(), '.cache/bento-deck-studio/tts');

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

/** What the narrator says: captions keep the written punctuation. */
function spoken(text) {
  return text.replace(/\s*—\s*/g, ', ').replace(/\bbento-deck-studio\b/gi, 'Bento Deck Studio');
}

function parseArgs(args) {
  const options = { engine: 'auto', voice: '21', pace: '1.15' };
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, '');
    if (!(key in options) || !args[i + 1]) throw new Error(`Unknown or incomplete option ${args[i]}. Usage: create-demo.mjs [--engine auto|kokoro|say] [--voice <kokoro speaker id>] [--pace <length scale>]`);
    options[key] = args[++i];
  }
  return options;
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** Locate the sherpa-onnx TTS binary and the Kokoro model under BDS_TTS_HOME. */
async function findKokoro() {
  const binary = process.env.BDS_SHERPA_TTS
    ?? (await readdir(TTS_HOME).catch(() => []))
      .filter((name) => name.startsWith('sherpa-onnx-') && !name.endsWith('.bz2'))
      .map((name) => path.join(TTS_HOME, name, 'bin/sherpa-onnx-offline-tts'))[0];
  const model = process.env.BDS_KOKORO_DIR ?? path.join(TTS_HOME, 'kokoro-multi-lang-v1_0');
  if (binary && await exists(binary) && await exists(path.join(model, 'model.onnx'))) return { binary, model };
  return null;
}

function speaker(engine, options) {
  if (engine.name === 'say') {
    return async (text, wavPath) => {
      const aiff = wavPath.replace(/\.wav$/, '.aiff');
      await run('say', ['-v', 'Karen', '-r', String(SAY_RATE), '-o', aiff, text]);
      await run('ffmpeg', ['-y', '-v', 'error', '-i', aiff, '-ar', String(SAMPLE_RATE), '-ac', '1', wavPath]);
    };
  }
  const { binary, model } = engine;
  return (text, wavPath) => run(binary, [
    `--kokoro-model=${model}/model.onnx`, `--kokoro-voices=${model}/voices.bin`, `--kokoro-tokens=${model}/tokens.txt`,
    `--kokoro-data-dir=${model}/espeak-ng-data`, `--kokoro-dict-dir=${model}/dict`,
    `--kokoro-lexicon=${model}/lexicon-gb-en.txt,${model}/lexicon-zh.txt`,
    `--kokoro-length-scale=${options.pace}`, '--num-threads=4', `--sid=${options.voice}`,
    `--output-filename=${wavPath}`, text
  ]);
}

async function durationOf(file) {
  const duration = Number(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file]));
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Could not read the duration of ${file}.`);
  return duration;
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

async function main(args) {
  const options = parseArgs(args);
  for (const destination of [outPath, captionsPath]) {
    if (await exists(destination)) throw new Error(`Refusing to overwrite an existing demo asset: ${destination}`);
  }
  const kokoro = options.engine === 'say' ? null : await findKokoro();
  if (options.engine === 'kokoro' && !kokoro) throw new Error(`Kokoro TTS not found under ${TTS_HOME}; see media/storyboard.md for the download.`);
  if (!kokoro && process.platform !== 'darwin') throw new Error('No Kokoro TTS found and the macOS say fallback is unavailable on this platform.');
  if (!kokoro) console.warn('Kokoro neural TTS not found — falling back to the macOS Karen voice, which sounds synthetic.');
  const engine = kokoro ? { name: 'kokoro', ...kokoro } : { name: 'say' };
  const speak = speaker(engine, options);

  const scenes = JSON.parse(await readFile(scenesPath, 'utf8'));
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'bento-demo-'));
  try {
    const silences = new Map();
    const silence = async (seconds) => {
      const key = seconds.toFixed(2);
      if (!silences.has(key)) {
        const file = path.join(tempDir, `silence-${key}.wav`);
        await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `anullsrc=r=${SAMPLE_RATE}:cl=mono`, '-t', key, file]);
        silences.set(key, file);
      }
      return silences.get(key);
    };

    // Synthesise sentence by sentence so the voice resets its phrasing naturally and every
    // caption cue starts exactly when its sentence is spoken.
    const segments = [];
    const captions = [];
    const captionImages = [];
    let cursor = 0;
    for (const [sceneIndex, scene] of scenes.entries()) {
      const parts = [];
      let offset = 0;
      const lines = sentences(scene.text);
      for (const [index, line] of lines.entries()) {
        const wavPath = path.join(tempDir, `voice-${sceneIndex + 1}-${index + 1}.wav`);
        await speak(spoken(line), wavPath);
        const duration = await durationOf(wavPath);
        const pause = index === lines.length - 1 ? PAUSE.scene : line.endsWith('?') ? PAUSE.question : PAUSE.sentence;
        parts.push(wavPath, await silence(pause));
        const imageSvg = path.join(tempDir, `caption-${captions.length + 1}.svg`);
        const imagePng = path.join(tempDir, `caption-${captions.length + 1}.png`);
        await writeFile(imageSvg, captionSvg(line));
        await run('sips', ['-s', 'format', 'png', imageSvg, '--out', imagePng]);
        const start = cursor + offset;
        const end = start + duration + pause * 0.6;
        captions.push(`${captions.length + 1}\n${timestamp(start)} --> ${timestamp(end)}\n${line}\n`);
        captionImages.push({ imagePng, start, end });
        offset += duration + pause;
      }
      const list = path.join(tempDir, `scene-${sceneIndex + 1}.txt`);
      await writeFile(list, parts.map((file) => `file '${file}'`).join('\n'));
      const audioPath = path.join(tempDir, `scene-${sceneIndex + 1}.wav`);
      await run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', audioPath]);
      const videoDuration = await durationOf(audioPath);
      segments.push({ ...scene, audioPath, videoDuration });
      cursor += videoDuration;
    }

    const total = cursor;
    if (total < 80 || total > 100) {
      throw new Error(`Narration is ${total.toFixed(1)} seconds; adjust the narration script or --pace to target about 90 seconds.`);
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
      filters.push(`[${audioInput}:a]aresample=48000,apad,atrim=duration=${segment.videoDuration.toFixed(3)}[a${index}]`);
    }
    const concatInputs = segments.map((_, index) => `[v${index}][a${index}]`).join('');
    filters.push(`${concatInputs}concat=n=${segments.length}:v=1:a=1[video][spoken]`);
    filters.push('[spoken]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[audio]');
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
    console.log(`Created ${outPath} (${total.toFixed(1)} seconds) with ${segments.length} scenes narrated by ${engine.name === 'kokoro' ? `Kokoro speaker ${options.voice}` : 'macOS Karen'}.`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(`Demo video creation failed: ${error.message}`);
  process.exitCode = 1;
});
