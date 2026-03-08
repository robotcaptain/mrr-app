#!/usr/bin/env node
/**
 * download-thumbs.mjs — Download episode thumbnails locally
 *
 * Downloads all thumbnailUrl images to public/images/thumbs/<id>.<ext>
 * and updates episodes.json to use local paths.
 *
 * Usage:
 *   node scripts/download-thumbs.mjs [--dry-run] [--slow]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, extname } from 'path';
import https from 'https';
import http from 'http';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SLOW = args.includes('--slow');

const THUMBS_DIR = 'public/images/thumbs';
const DATA_PATH = 'public/data/episodes.json';

function fetch(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'MRR-Radio-App/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const data = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
  const episodes = data.episodes.filter((e) => e.thumbnailUrl);

  if (!DRY_RUN) mkdirSync(THUMBS_DIR, { recursive: true });

  console.log(`${episodes.length} episodes with thumbnails to download`);
  if (DRY_RUN) console.log('(dry run — no files will be written)');

  let downloaded = 0, skipped = 0, failed = 0;

  for (const ep of episodes) {
    const url = ep.thumbnailUrl;
    // Determine extension from URL
    const urlPath = new URL(url).pathname;
    let ext = extname(urlPath).split('?')[0]; // e.g. ".jpg"
    if (!ext) ext = '.jpg'; // fallback

    const filename = `${ep.id}${ext}`;
    const localPath = join(THUMBS_DIR, filename);
    const publicPath = `/images/thumbs/${filename}`;

    // Skip if already downloaded
    if (existsSync(localPath)) {
      ep.thumbnailUrl = publicPath;
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [dry] ${ep.id}: ${url} → ${publicPath}`);
      downloaded++;
      continue;
    }

    try {
      const buf = await fetch(url);
      writeFileSync(localPath, buf);
      ep.thumbnailUrl = publicPath;
      downloaded++;
      if (downloaded % 25 === 0) {
        console.log(`  ${downloaded} downloaded...`);
        // Checkpoint save
        writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
      }
      if (SLOW) await delay(2000);
    } catch (err) {
      console.warn(`  FAIL ${ep.id}: ${err.message}`);
      failed++;
      // Keep original URL for failed ones
    }
  }

  if (!DRY_RUN) {
    writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  }

  console.log(`\nDone: ${downloaded} downloaded, ${skipped} already existed, ${failed} failed`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
