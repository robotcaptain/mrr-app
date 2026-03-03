#!/usr/bin/env node
/**
 * analyze-tracks.mjs
 *
 * Uses ffmpeg silencedetect to find track boundaries in a downloaded MP3,
 * then writes startTime (seconds) onto each track in episodes.json.
 *
 * Clustering: groups silence_end points within CLUSTER_GAP seconds of each
 * other and takes the LAST point in each cluster — the moment the new track
 * has firmly started (audio clearly above threshold).
 *
 * Usage:
 *   node scripts/analyze-tracks.mjs 1975
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA_FILE = resolve(ROOT, 'public/data/episodes.json');
const AUDIO_DIR = resolve(ROOT, 'public/audio');

// Tuning parameters
const NOISE_DB     = '-50dB';   // detection threshold
const MIN_DURATION = 0.3;       // minimum silence duration (seconds)
const INTRO_SKIP   = 10;        // skip silence_end points in first N seconds
const CLUSTER_GAP  = 60;        // silence_end points within this many seconds = same boundary

const arg = process.argv[2];
if (!arg || !/^\d+$/.test(arg)) {
  console.error('Usage: node scripts/analyze-tracks.mjs <episodeId>');
  process.exit(1);
}
const episodeId = parseInt(arg, 10);

const mp3File = resolve(AUDIO_DIR, `mrr-radio-${episodeId}.mp3`);
if (!existsSync(mp3File)) {
  console.error(`Error: ${mp3File} not found.`);
  console.error(`Run: node scripts/download-mp3.mjs ${episodeId}`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
} catch (err) {
  console.error(`Error reading episodes.json: ${err.message}`);
  process.exit(1);
}

const episode = data.episodes.find((ep) => ep.id === episodeId);
if (!episode) { console.error(`Episode ${episodeId} not found.`); process.exit(1); }
if (!episode.tracks?.length) { console.error(`Episode ${episodeId} has no tracks.`); process.exit(1); }

const trackCount = episode.tracks.length;
console.log(`Episode #${episodeId} — ${trackCount} tracks`);
console.log(`Running ffmpeg (noise=${NOISE_DB} d=${MIN_DURATION}s)...`);

const result = spawnSync('ffmpeg', [
  '-i', mp3File,
  '-af', `silencedetect=noise=${NOISE_DB}:d=${MIN_DURATION}`,
  '-f', 'null', '-',
], { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });

if (result.error) {
  console.error(`ffmpeg error: ${result.error.message}`);
  process.exit(1);
}

const ffmpegOutput = (result.stderr || '') + (result.stdout || '');

// Parse all silence_end values
const silenceEndRe = /silence_end:\s*([\d.]+)\s*\|/g;
const rawEnds = [];
let m;
while ((m = silenceEndRe.exec(ffmpegOutput)) !== null) rawEnds.push(parseFloat(m[1]));

console.log(`Found ${rawEnds.length} silence_end points.`);

// Filter out intro silence
const filtered = rawEnds.filter((t) => t >= INTRO_SKIP);
console.log(`After skipping first ${INTRO_SKIP}s: ${filtered.length} points.`);

// Cluster consecutive points within CLUSTER_GAP seconds; take last of each cluster
const clusters = [];
for (const t of filtered) {
  if (clusters.length === 0 || t - clusters[clusters.length - 1] > CLUSTER_GAP) {
    clusters.push(t); // start new cluster (store current "last" point)
  } else {
    clusters[clusters.length - 1] = t; // update last point of current cluster
  }
}

console.log(`After clustering (gap=${CLUSTER_GAP}s): ${clusters.length} boundaries.`);
console.log(`Need ${trackCount - 1} boundaries for ${trackCount} tracks.`);

// Assign startTime to tracks
const sorted = [...episode.tracks].sort((a, b) => a.trackIndex - b.trackIndex);

for (const track of sorted) {
  const idx = track.trackIndex;
  if (idx === 0) {
    track.startTime = 0;
  } else {
    const ci = idx - 1;
    if (ci < clusters.length) {
      track.startTime = Math.round(clusters[ci] * 10) / 10;
    } else {
      delete track.startTime; // no boundary detected for this track
    }
  }
}

episode.tracks = episode.tracks.map((t) => sorted.find((s) => s.id === t.id) || t);
episode.indexed = true;

writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
console.log('episodes.json updated: startTime on tracks, indexed=true.');
console.log('');

// Summary table
const indexed = sorted.filter((t) => t.startTime !== undefined).length;
console.log(`${indexed}/${trackCount} tracks have timestamps.`);
console.log('');
console.log('Idx   StartTime    Artist                         Title');
console.log('-'.repeat(80));
for (const t of sorted) {
  const idx   = String(t.trackIndex).padEnd(5);
  const start = (t.startTime !== undefined ? fmtTime(t.startTime) : '—').padEnd(12);
  const art   = (t.artist || '').slice(0, 29).padEnd(30);
  console.log(`${idx} ${start} ${art} ${t.title || ''}`);
}

function fmtTime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
