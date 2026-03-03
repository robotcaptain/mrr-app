#!/usr/bin/env node
/**
 * download-mp3.mjs
 *
 * Downloads the MP3 for a specific episode from its mp3Url in episodes.json.
 *
 * Usage:
 *   node scripts/download-mp3.mjs 1975
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, createWriteStream, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA_FILE = resolve(ROOT, 'public/data/episodes.json');
const AUDIO_DIR = resolve(ROOT, 'public/audio');

// ── Parse CLI arg ─────────────────────────────────────────────────────────────
const arg = process.argv[2];
if (!arg || !/^\d+$/.test(arg)) {
  console.error('Usage: node scripts/download-mp3.mjs <episodeId>');
  console.error('Example: node scripts/download-mp3.mjs 1975');
  process.exit(1);
}
const episodeId = parseInt(arg, 10);

// ── Load episodes.json ────────────────────────────────────────────────────────
if (!existsSync(DATA_FILE)) {
  console.error(`Error: ${DATA_FILE} not found.`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
} catch (err) {
  console.error(`Error reading episodes.json: ${err.message}`);
  process.exit(1);
}

if (!Array.isArray(data.episodes)) {
  console.error('Error: episodes.json does not contain an "episodes" array.');
  process.exit(1);
}

// ── Find episode ──────────────────────────────────────────────────────────────
const episode = data.episodes.find((ep) => ep.id === episodeId);
if (!episode) {
  console.error(`Error: Episode ${episodeId} not found in episodes.json.`);
  process.exit(1);
}

if (!episode.mp3Url) {
  console.error(`Error: Episode ${episodeId} has no mp3Url.`);
  process.exit(1);
}

// ── Destination path ──────────────────────────────────────────────────────────
mkdirSync(AUDIO_DIR, { recursive: true });
const destFile = resolve(AUDIO_DIR, `mrr-radio-${episodeId}.mp3`);

if (existsSync(destFile)) {
  console.log(`Already downloaded: ${destFile}`);
  // Ensure localAudio is marked true in case it was missed
  if (!episode.localAudio) {
    episode.localAudio = true;
    writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    console.log('Updated episodes.json: localAudio set to true.');
  }
  process.exit(0);
}

// ── Download with redirect following and progress ─────────────────────────────
function downloadWithProgress(url, dest, hops = 0) {
  return new Promise((ok, fail) => {
    if (hops > 10) return fail(new Error('Too many redirects'));
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'MRRRadioDownloader/1.0' } }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const redirectUrl = new URL(res.headers.location, url).href;
        console.log(`  Redirecting to: ${redirectUrl}`);
        return ok(downloadWithProgress(redirectUrl, dest, hops + 1));
      }

      if (res.statusCode !== 200) {
        res.resume();
        return fail(new Error(`HTTP ${res.statusCode} for ${url}`));
      }

      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      let lastPct = -1;

      const writer = createWriteStream(dest);

      res.on('data', (chunk) => {
        received += chunk.length;
        if (total > 0) {
          const pct = Math.floor((received / total) * 100);
          if (pct !== lastPct && pct % 5 === 0) {
            const receivedMB = (received / 1024 / 1024).toFixed(1);
            const totalMB = (total / 1024 / 1024).toFixed(1);
            process.stdout.write(`\r  ${receivedMB} MB / ${totalMB} MB (${pct}%)`);
            lastPct = pct;
          }
        } else {
          // No content-length header — just show bytes received
          const receivedMB = (received / 1024 / 1024).toFixed(1);
          process.stdout.write(`\r  ${receivedMB} MB received`);
        }
      });

      res.pipe(writer);

      writer.on('finish', () => {
        process.stdout.write('\n');
        ok();
      });

      writer.on('error', (err) => {
        fail(err);
      });

      res.on('error', (err) => {
        writer.destroy(err);
        fail(err);
      });
    });

    req.on('error', fail);
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`Episode #${episodeId}`);
console.log(`Source:  ${episode.mp3Url}`);
console.log(`Dest:    ${destFile}`);
console.log('Downloading...');

try {
  await downloadWithProgress(episode.mp3Url, destFile);
  console.log('Download complete.');

  // Update episodes.json
  episode.localAudio = true;
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  console.log('Updated episodes.json: localAudio set to true.');
} catch (err) {
  console.error(`\nDownload failed: ${err.message}`);
  // Clean up partial file if it exists
  if (existsSync(destFile)) {
    try { unlinkSync(destFile); } catch (_) { /* ignore cleanup errors */ }
  }
  process.exit(1);
}
