#!/usr/bin/env node
/**
 * MRR Radio Scraper
 *
 * Usage:
 *   node scripts/scrape.mjs                  # fetch 15 most recent episodes
 *   node scripts/scrape.mjs --all             # full archive (~800 episodes)
 *   node scripts/scrape.mjs --since 1970      # episodes above number 1970
 *   node scripts/scrape.mjs --download        # also download MP3s locally
 *
 * Outputs: public/data/episodes.json
 * Downloads: public/audio/mrr-radio-[N].mp3  (with --download)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, createWriteStream } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA_DIR = resolve(ROOT, 'public/data');
const AUDIO_DIR = resolve(ROOT, 'public/audio');
const OUTPUT_FILE = resolve(DATA_DIR, 'episodes.json');

const BASE_URL = 'https://www.maximumrocknroll.com';
const RSS_URL = `${BASE_URL}/cat/mrr-radio/mrr-radio-podcast/feed/`;

const args = process.argv.slice(2);
const MODE_ALL = args.includes('--all');
const MODE_DOWNLOAD = args.includes('--download');
const SINCE_IDX = args.indexOf('--since');
const SINCE_NUM = SINCE_IDX !== -1 ? parseInt(args[SINCE_IDX + 1], 10) : 0;
const RECENT_COUNT = 15;

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

function fetchUrl(url, hops = 0) {
  return new Promise((ok, fail) => {
    if (hops > 10) return fail(new Error('Too many redirects'));
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MRRRadioScraper/1.0)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redir = new URL(res.headers.location, url).href;
        res.resume();
        return ok(fetchUrl(redir, hops + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return fail(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => ok(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', fail);
    });
    req.on('error', fail);
  });
}

function downloadBinary(url, dest, hops = 0) {
  return new Promise((ok, fail) => {
    if (hops > 10) return fail(new Error('Too many redirects'));
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'MRRRadioScraper/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redir = new URL(res.headers.location, url).href;
        res.resume();
        return ok(downloadBinary(redir, dest, hops + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return fail(new Error(`HTTP ${res.statusCode}`));
      }
      const writer = createWriteStream(dest);
      res.pipe(writer);
      writer.on('finish', ok);
      writer.on('error', fail);
    });
    req.on('error', fail);
  });
}

function parseRssPage(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
      block.match(/<title>(.*?)<\/title>/))?.[1]?.trim() || '';
    const link = (block.match(/<link>(.*?)<\/link>/) || [])[1]?.trim() || '';
    const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1]?.trim() || '';
    const desc = (block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || [])[1]?.trim() || '';
    const enclosure = block.match(/<enclosure url="([^"]+)"[^/]*\/>/)?.[1] || '';
    const duration = (block.match(/<itunes:duration>(.*?)<\/itunes:duration>/) || [])[1]?.trim() || '';

    if (!enclosure) continue;

    const epNumMatch = title.match(/#(\d+)/) || link.match(/mrr-radio-(\d+)/);
    const epNum = epNumMatch ? parseInt(epNumMatch[1], 10) : null;
    if (!epNum) continue;

    let durationSecs = 0;
    if (duration) {
      const parts = duration.split(':').map(Number);
      if (parts.length === 3) durationSecs = parts[0] * 3600 + parts[1] * 60 + parts[2];
      else if (parts.length === 2) durationSecs = parts[0] * 60 + parts[1];
      else durationSecs = parts[0] || 0;
    }

    const dateObj = pubDate ? new Date(pubDate) : null;
    const date = dateObj ? dateObj.toISOString().slice(0, 10) : '';

    const hostMatch = desc.match(/hosted by ([^<\n,]+)/i);
    const host = hostMatch ? hostMatch[1].trim().replace(/[.,!?]+$/, '') : '';

    const caption = desc.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);

    items.push({ epNum, date, host, caption, mp3Url: enclosure, durationSecs, link });
  }
  return items;
}

function parseEpisodePage(html) {
  let thumbnailUrl = null;
  const contentMatch = html.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)(?:<div[^>]*class="[^"]*(?:entry-footer|sharedaddy|jp-relatedposts)[^"]*"|$)/);
  const content = contentMatch ? contentMatch[1] : html;

  const imgSrc = content.match(/<img[^>]+src="([^"]+\.(jpg|jpeg|png|webp))[^"]*"/i);
  if (imgSrc) {
    thumbnailUrl = imgSrc[1];
    if (thumbnailUrl.startsWith('/')) thumbnailUrl = BASE_URL + thumbnailUrl;
  }

  const tracks = [];
  let currentSection = '';

  const decode = (s) => s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#8211;/g, '\u2013').replace(/&#8212;/g, '\u2014')
    .replace(/&#8220;/g, '\u201C').replace(/&#8221;/g, '\u201D')
    .replace(/&#8216;/g, '\u2018').replace(/&#8217;/g, '\u2019')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([\da-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));

  const lines = content
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '\n__STRONG__$1__STRONG__\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p[^>]*>/gi, '\n').replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((l) => decode(l).trim())
    .filter((l) => l.length > 0);

  let trackIndex = 0;
  for (const line of lines) {
    if (line.startsWith('__STRONG__') && line.endsWith('__STRONG__')) {
      currentSection = line.slice(10, -10).trim();
      continue;
    }
    const trackMatch = line.match(/^(.+?)\s*[\u2013\u2014-]\s*(.+)$/);
    if (trackMatch) {
      const rawArtist = trackMatch[1].trim();
      const rawTitle = trackMatch[2].trim();
      if (
        rawArtist.length > 0 && rawTitle.length > 0 &&
        rawArtist.length < 80 && rawTitle.length < 150 &&
        !rawArtist.startsWith('http') && !rawArtist.match(/^\d{4}/)
      ) {
        tracks.push({
          artist: rawArtist.toUpperCase().trim(),
          title: rawTitle.trim(),
          section: currentSection,
          trackIndex: trackIndex++,
        });
      }
    }
  }

  return { thumbnailUrl, tracks };
}

async function fetchRssItems(targetCount) {
  const items = [];
  let page = 1;
  while (true) {
    const url = page === 1 ? RSS_URL : `${RSS_URL}?paged=${page}`;
    console.log(`  RSS page ${page}: ${url}`);
    const xml = await fetchUrl(url);
    const pageItems = parseRssPage(xml);
    if (pageItems.length === 0) break;
    items.push(...pageItems);
    if (!MODE_ALL && items.length >= targetCount) break;
    page++;
    await delay(300);
  }
  return items;
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(AUDIO_DIR, { recursive: true });

  let existing = [];
  if (existsSync(OUTPUT_FILE)) {
    try {
      const raw = JSON.parse(readFileSync(OUTPUT_FILE, 'utf-8'));
      existing = Array.isArray(raw.episodes) ? raw.episodes : raw;
      console.log(`Loaded ${existing.length} existing episodes`);
    } catch { console.log('Starting fresh'); }
  }
  const existingIds = new Set(existing.map((e) => e.id));

  console.log('\n── Fetching RSS ──');
  const rssItems = await fetchRssItems(SINCE_NUM ? 9999 : RECENT_COUNT);

  const toFetch = rssItems.filter((ep) => {
    if (SINCE_NUM && ep.epNum <= SINCE_NUM) return false;
    if (!MODE_ALL && existingIds.has(ep.epNum)) return false;
    return true;
  });

  if (toFetch.length === 0) {
    console.log('No new episodes. Up to date.');
    return;
  }

  console.log(`\n── Fetching ${toFetch.length} episode pages ──`);
  const newEpisodes = [];
  const newTracks = {};

  for (let i = 0; i < toFetch.length; i++) {
    const ep = toFetch[i];
    const pageUrl = ep.link || `${BASE_URL}/radio_show/mrr-radio-${ep.epNum}/`;
    console.log(`  [${i + 1}/${toFetch.length}] #${ep.epNum}: ${pageUrl}`);

    let thumbnailUrl = null;
    let tracks = [];
    try {
      const html = await fetchUrl(pageUrl);
      const parsed = parseEpisodePage(html);
      thumbnailUrl = parsed.thumbnailUrl;
      tracks = parsed.tracks;
    } catch (err) {
      console.warn(`    ! Page fetch failed: ${err.message}`);
    }

    const episode = {
      id: ep.epNum,
      date: ep.date,
      host: ep.host,
      caption: ep.caption,
      thumbnailUrl,
      mp3Url: ep.mp3Url,
      durationSecs: ep.durationSecs,
      trackCount: tracks.length,
      localAudio: false,
    };

    newTracks[ep.epNum] = tracks.map((t, idx) => ({
      id: ep.epNum * 10000 + idx,
      episodeId: ep.epNum,
      ...t,
    }));

    if (MODE_DOWNLOAD && ep.mp3Url) {
      const audioPath = resolve(AUDIO_DIR, `mrr-radio-${ep.epNum}.mp3`);
      if (!existsSync(audioPath)) {
        console.log('    ↓ Downloading MP3...');
        try {
          await downloadBinary(ep.mp3Url, audioPath);
          episode.localAudio = true;
          console.log('    ✓ Downloaded');
        } catch (err) {
          console.warn(`    ! Download failed: ${err.message}`);
        }
      } else {
        episode.localAudio = true;
      }
    }

    newEpisodes.push(episode);
    await delay(500);
  }

  const merged = [
    ...newEpisodes,
    ...existing.filter((e) => !newEpisodes.find((n) => n.id === e.id)),
  ].sort((a, b) => b.id - a.id);

  const existingTracksMap = existing.reduce((acc, ep) => {
    if (ep.tracks) acc[ep.id] = ep.tracks;
    return acc;
  }, {});
  const mergedTracks = { ...existingTracksMap, ...newTracks };

  const output = {
    generated: new Date().toISOString(),
    count: merged.length,
    episodes: merged.map((ep) => ({ ...ep, tracks: mergedTracks[ep.id] || [] })),
  };

  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\n✓ ${merged.length} episodes written to public/data/episodes.json`);
}

main().catch((err) => { console.error('Scraper failed:', err); process.exit(1); });
