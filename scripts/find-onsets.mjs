#!/usr/bin/env node
/**
 * find-onsets.mjs
 *
 * Detects track boundaries in a downloaded MP3 using ffmpeg astats +
 * first-derivative onset detection. Overwrites startTime on all tracks
 * in episodes.json with verified-candidate timestamps.
 *
 * How it works:
 *   1. Run ffmpeg astats (50ms windows) on the full MP3 → per-frame RMS in dB
 *   2. Smooth with a sliding median (~500ms window) to reduce transient noise
 *   3. Compute first derivative (frame-to-frame delta of smoothed RMS)
 *   4. Find local maxima above DERIVATIVE_THRESHOLD, enforcing MIN_TRACK_GAP_SECS
 *   5. Select exactly (trackCount - 1) boundaries by peak prominence
 *   6. Score each onset by strength + isolation → confidence 0–1
 *   7. Write results to episodes.json (unless --dry-run)
 *
 * Usage:
 *   node scripts/find-onsets.mjs 1975
 *   node scripts/find-onsets.mjs 1975 --dry-run        # print only, no write
 *   node scripts/find-onsets.mjs 1975 --all-candidates # show all peaks before selection
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');
const DATA_FILE = resolve(ROOT, 'public/data/episodes.json');
const AUDIO_DIR = resolve(ROOT, 'public/audio');

// ─── Tuning constants ──────────────────────────────────────────────────────────
const FRAME_WINDOW_SECS    = 0.05;  // astats integration window (50ms) — controls smoothing
                                     // NOTE: output frame rate is the codec's native rate
                                     // (~23ms for 44.1kHz/1024-sample frames), not this value.
                                     // minGapFrames and smooth window are derived from actual data.
const SMOOTH_WINDOW_SECS   = 0.5;   // target smoothing window in seconds (~500ms)
const DERIVATIVE_THRESHOLD = 2.0;   // dB/frame minimum delta for onset candidate
const MIN_TRACK_GAP_SECS   = 10;    // minimum seconds between detected tracks
// ──────────────────────────────────────────────────────────────────────────────

// ─── Parse CLI args ────────────────────────────────────────────────────────────
const args          = process.argv.slice(2);
const episodeArg    = args.find(a => /^\d+$/.test(a));
const dryRun        = args.includes('--dry-run');
const allCandidates = args.includes('--all-candidates');

if (!episodeArg) {
  console.error('Usage: node scripts/find-onsets.mjs <episodeId> [--dry-run] [--all-candidates]');
  process.exit(1);
}
const episodeId = parseInt(episodeArg, 10);
// ──────────────────────────────────────────────────────────────────────────────

// Load episodes.json
let data;
try {
  data = JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
} catch (err) {
  console.error(`Error reading episodes.json: ${err.message}`);
  process.exit(1);
}

const episode = data.episodes.find(ep => ep.id === episodeId);
if (!episode)           { console.error(`Episode ${episodeId} not found.`);       process.exit(1); }
if (!episode.tracks?.length) { console.error(`Episode ${episodeId} has no tracks.`); process.exit(1); }

const mp3File = resolve(AUDIO_DIR, `mrr-radio-${episodeId}.mp3`);
if (!existsSync(mp3File)) {
  console.error(`Error: ${mp3File} not found.`);
  console.error(`Run: node scripts/download-mp3.mjs ${episodeId}`);
  process.exit(1);
}

const trackCount      = episode.tracks.length;
const boundariesNeeded = trackCount - 1; // track 0 always starts at 0

console.log(`\nEpisode #${episodeId}: ${trackCount} tracks, ${fmtTime(episode.durationSecs)} total`);
console.log(`Need to detect ${boundariesNeeded} track boundaries.`);
console.log(`Running ffmpeg astats (frame=${FRAME_WINDOW_SECS}s)...\n`);

// ─── Main pipeline ─────────────────────────────────────────────────────────────
const frames = extractFrameRMS(mp3File);

// Derive actual frame duration from pts_time values (codec native rate, not FRAME_WINDOW_SECS)
const actualFrameDuration = frames.length > 1
  ? (frames[frames.length - 1].time - frames[0].time) / (frames.length - 1)
  : FRAME_WINDOW_SECS;
const smoothWindowFrames = Math.max(3, Math.round(SMOOTH_WINDOW_SECS / actualFrameDuration));
const minGapFrames       = Math.ceil(MIN_TRACK_GAP_SECS / actualFrameDuration);

console.log(`Extracted ${frames.length} frames (actual frame: ${(actualFrameDuration * 1000).toFixed(1)}ms, smooth: ${smoothWindowFrames} frames, gap: ${minGapFrames} frames)`);

const rmsValues  = frames.map(f => f.rms);
const smoothed   = smoothMedian(rmsValues, smoothWindowFrames);
const derivative = firstDerivative(smoothed);

const candidates = findOnsetCandidates(frames, derivative, minGapFrames, DERIVATIVE_THRESHOLD);
console.log(`Found ${candidates.length} onset candidates (threshold=${DERIVATIVE_THRESHOLD}, gap=${MIN_TRACK_GAP_SECS}s)`);

if (allCandidates) {
  console.log('\nAll candidates:');
  candidates.forEach((c, i) => {
    console.log(`  ${String(i + 1).padStart(3)}. ${fmtTime(c.time).padEnd(10)} delta=${c.delta.toFixed(2).padStart(6)} dB/frame`);
  });
  console.log('');
}

let selected;
if (candidates.length >= boundariesNeeded) {
  selected = selectTopN(candidates, boundariesNeeded);
  console.log(`Selected top ${boundariesNeeded} by peak prominence, sorted chronologically.`);
} else {
  selected = [...candidates].sort((a, b) => a.time - b.time);
  console.log(`\n⚠  Only ${candidates.length} candidates found (need ${boundariesNeeded}).`);
  console.log(`   Lower DERIVATIVE_THRESHOLD (currently ${DERIVATIVE_THRESHOLD}) and re-run.`);
}

const scored = scoreOnsets(selected, episode.durationSecs);
const sorted  = [...episode.tracks].sort((a, b) => a.trackIndex - b.trackIndex);
assignTimestamps(sorted, scored, episode.durationSecs);

printTable(sorted, episode.durationSecs);

if (!dryRun) {
  episode.tracks = episode.tracks.map(t => sorted.find(s => s.id === t.id) || t);
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  console.log('\nWritten to episodes.json.');
  console.log('Run again with --dry-run to preview without writing.');
} else {
  console.log('\n--dry-run mode: episodes.json was NOT modified.');
}
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Run ffmpeg astats on the MP3 and return an array of { time, rms } objects,
 * one per 50ms frame. rms is in dB (-100 for silence, -inf coerced to -100).
 *
 * We filter ametadata output to a single key (Overall.RMS_level) to keep
 * stdout small (~7 MB for a 57-min episode vs ~220 MB for all keys).
 * Frame times are derived from pts_time when present, or computed as
 * frameIndex × FRAME_WINDOW_SECS as a fallback.
 */
function extractFrameRMS(mp3File) {
  const rmsKey = 'lavfi.astats.Overall.RMS_level';
  const result = spawnSync('ffmpeg', [
    '-i', mp3File,
    '-af', `astats=length=${FRAME_WINDOW_SECS}:metadata=1:reset=1,ametadata=mode=print:key=${rmsKey}:file=-`,
    '-f', 'null', '-',
  ], { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });

  if (result.error) {
    console.error(`ffmpeg error: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0 && !result.stdout) {
    console.error('ffmpeg failed with no output. Is ffmpeg installed?');
    process.exit(1);
  }

  const frames = [];
  let currentTime = null;
  let frameIndex  = 0;

  for (const line of (result.stdout || '').split('\n')) {
    // Frame descriptor line: "frame:N  pts:P  pts_time:T"
    const timeMatch = line.match(/pts_time:([\d.]+)/);
    if (timeMatch) {
      currentTime = parseFloat(timeMatch[1]);
      continue;
    }
    // RMS line: "lavfi.astats.Overall.RMS_level=VALUE"
    if (line.startsWith(rmsKey + '=')) {
      const raw = line.slice(rmsKey.length + 1).trim();
      const rms = (raw === '-inf' || raw === 'inf') ? -100 : parseFloat(raw);
      // Use pts_time if available, else derive from frame count
      const time = currentTime !== null ? currentTime : frameIndex * FRAME_WINDOW_SECS;
      frames.push({ time, rms });
      currentTime = null;
      frameIndex++;
    }
  }

  if (frames.length === 0) {
    console.error('No frames extracted. Check ffmpeg output and MP3 path.');
    process.exit(1);
  }

  return frames;
}

/**
 * Sliding median smoothing. Reduces transient noise in the RMS curve.
 * windowSize frames on each side (centered window of ~windowSize+1 frames).
 */
function smoothMedian(values, windowSize) {
  const half = Math.floor(windowSize / 2);
  return values.map((_, i) => {
    const start  = Math.max(0, i - half);
    const end    = Math.min(values.length, i + half + 1);
    const window = values.slice(start, end).slice().sort((a, b) => a - b);
    return window[Math.floor(window.length / 2)];
  });
}

/**
 * First derivative: frame-to-frame delta of the smoothed RMS curve.
 * A large positive value indicates a sudden energy increase (track attack).
 */
function firstDerivative(values) {
  return values.map((v, i) => i === 0 ? 0 : v - values[i - 1]);
}

/**
 * Find all local maxima of the derivative that exceed the threshold,
 * then enforce minimum gap by keeping only the strongest peak in each window.
 * Returns candidates sorted by time.
 */
function findOnsetCandidates(frames, derivative, minGapFrames, threshold) {
  // Find local maxima above threshold
  const rawPeaks = [];
  for (let i = 1; i < derivative.length - 1; i++) {
    if (
      derivative[i] > threshold &&
      derivative[i] >= derivative[i - 1] &&
      derivative[i] >= derivative[i + 1]
    ) {
      rawPeaks.push({ frameIdx: i, time: frames[i].time, delta: derivative[i] });
    }
  }

  // Greedy minimum-gap enforcement: sort by strength, keep strongest non-conflicting peaks
  rawPeaks.sort((a, b) => b.delta - a.delta);
  const kept = [];
  for (const peak of rawPeaks) {
    const tooClose = kept.some(k => Math.abs(k.frameIdx - peak.frameIdx) < minGapFrames);
    if (!tooClose) kept.push(peak);
  }

  kept.sort((a, b) => a.time - b.time);
  return kept;
}

/**
 * Select top N candidates by peak delta, then sort chronologically.
 */
function selectTopN(candidates, n) {
  return [...candidates]
    .sort((a, b) => b.delta - a.delta)
    .slice(0, n)
    .sort((a, b) => a.time - b.time);
}

/**
 * Score each detected onset with a confidence value 0–1.
 * Based on: peak strength (70%) + isolation from neighbors (30%).
 */
function scoreOnsets(onsets, episodeDurationSecs) {
  if (onsets.length === 0) return [];

  const maxDelta = Math.max(...onsets.map(o => o.delta));

  return onsets.map((onset, i) => {
    const strengthScore = onset.delta / maxDelta;

    const prevTime = i === 0 ? 0 : onsets[i - 1].time;
    const nextTime = i === onsets.length - 1 ? episodeDurationSecs : onsets[i + 1].time;
    const minGap   = Math.min(onset.time - prevTime, nextTime - onset.time);
    // 60s gap → isolation score of 1.0; shorter gaps → proportionally lower
    const isolationScore = Math.min(1, minGap / 60);

    const confidence = Math.round((0.7 * strengthScore + 0.3 * isolationScore) * 100) / 100;
    return { ...onset, confidence };
  });
}

/**
 * Write startTime, startTimeMethod, startTimeConfidence, and durationSecs
 * onto each track object. Track 0 always gets startTime=0, method="manual".
 * tracks must be sorted by trackIndex.
 */
function assignTimestamps(tracks, scoredOnsets, episodeDurationSecs) {
  // onset i (0-indexed) → track index i+1
  const onsetMap = {};
  scoredOnsets.forEach((o, i) => { onsetMap[i + 1] = o; });

  for (const track of tracks) {
    const idx   = track.trackIndex;
    const onset = onsetMap[idx];

    if (idx === 0) {
      track.startTime       = 0;
      track.startTimeMethod = 'manual';
      delete track.startTimeConfidence;
    } else if (onset) {
      track.startTime           = Math.round(onset.time * 10) / 10;
      track.startTimeConfidence = onset.confidence;
      track.startTimeMethod     = 'onset-derivative';
    } else {
      delete track.startTime;
      delete track.startTimeConfidence;
      track.startTimeMethod = 'onset-derivative';
    }
  }

  // Compute durationSecs for each track
  for (let i = 0; i < tracks.length; i++) {
    const curr = tracks[i];
    const next = tracks[i + 1];

    if (curr.startTime !== undefined) {
      if (next?.startTime !== undefined) {
        curr.durationSecs = Math.round((next.startTime - curr.startTime) * 10) / 10;
      } else if (i === tracks.length - 1) {
        curr.durationSecs = Math.round((episodeDurationSecs - curr.startTime) * 10) / 10;
      } else {
        curr.durationSecs = null;
      }
    } else {
      curr.durationSecs = null;
    }
  }
}

/**
 * Print a formatted summary table to stdout.
 */
function printTable(tracks, episodeDurationSecs) {
  const header = '  Idx  Track                                                  StartTime  Confidence  Duration';
  console.log(`\nDetected track boundaries for episode #${episodeId} (${trackCount} tracks, ${fmtTime(episodeDurationSecs)} total):\n`);
  console.log(header);
  console.log('  ' + '-'.repeat(header.length - 2));

  const lowConf = [];

  for (const t of tracks) {
    const idxStr   = String(t.trackIndex).padStart(3);
    const name     = `${t.artist} \u2013 ${t.title}`;
    const nameStr  = name.slice(0, 52).padEnd(53);
    const startStr = (t.startTime !== undefined ? fmtTime(t.startTime) : '\u2014').padEnd(10);
    const confStr  = t.trackIndex === 0
      ? '(fixed)   '
      : (t.startTimeConfidence !== undefined
          ? String(t.startTimeConfidence.toFixed(2)).padEnd(10)
          : '?'.padEnd(10));
    const durStr   = (t.durationSecs !== null && t.durationSecs !== undefined)
      ? fmtTime(t.durationSecs)
      : '\u2014';

    console.log(`  ${idxStr}  ${nameStr}${startStr} ${confStr} ${durStr}`);

    if (t.trackIndex > 0 && t.startTimeConfidence !== undefined && t.startTimeConfidence < 0.65) {
      lowConf.push(t.trackIndex);
    }
  }

  console.log('');

  if (lowConf.length > 0) {
    console.log(`  \u26a0  Tracks with confidence < 0.65: #${lowConf.join(', #')}  \u2014 verify by listening`);
  }

  const sumDuration = tracks.reduce((s, t) => s + (t.durationSecs || 0), 0);
  const diff        = Math.abs(sumDuration - episodeDurationSecs);
  const sumOk       = diff < 10;
  console.log(`  Sum check: ${fmtTime(sumDuration)} / ${fmtTime(episodeDurationSecs)} (${sumOk ? '\u2713 OK' : `\u26a0 off by ${diff.toFixed(0)}s`})`);
  console.log('');
}

function fmtTime(secs) {
  if (secs == null) return '\u2014';
  const h  = Math.floor(secs / 3600);
  const m  = Math.floor((secs % 3600) / 60);
  const s  = Math.floor(secs % 60);
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
