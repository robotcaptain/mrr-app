#!/usr/bin/env node
/**
 * MRR Radio Scraper
 *
 * Parses RSS for episode metadata + tracklist, then fetches each episode page
 * to extract the featured thumbnail image.
 *
 * Usage:
 *   node scripts/scrape.mjs                  # 15 most recent episodes
 *   node scripts/scrape.mjs --all             # full archive (multi-page)
 *   node scripts/scrape.mjs --since 1970      # only episodes > 1970
 *   node scripts/scrape.mjs --download        # also download MP3s locally
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
const RSS_BASE = `${BASE_URL}/cat/mrr-radio/mrr-radio-podcast/feed/`;

const args = process.argv.slice(2);
const MODE_ALL = args.includes('--all');
const MODE_DOWNLOAD = args.includes('--download');
const MODE_SLOW = args.includes('--slow'); // 10s between episodes to avoid rate limiting
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
        res.resume();
        return ok(fetchUrl(new URL(res.headers.location, url).href, hops + 1));
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
        res.resume();
        return ok(downloadBinary(new URL(res.headers.location, url).href, dest, hops + 1));
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

// ── HTML/entity decode ────────────────────────────────────────────────────────
function decode(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#8211;/g, '\u2013').replace(/&#8212;/g, '\u2014')
    .replace(/&#8216;/g, '\u2018').replace(/&#8217;/g, '\u2019')
    .replace(/&#8220;/g, '\u201C').replace(/&#8221;/g, '\u201D')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([\da-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// ── Extract featured thumbnail from episode page ──────────────────────────────
async function fetchThumbnail(epNum) {
  try {
    // 1621.5 → "1621-5", 1583.52 → "1583-5-2" (Part 2)
    const s = String(epNum);
    let slug;
    if (/\.\d{2,}$/.test(s)) {
      slug = s.replace('.', '-').replace(/(\d)(\d)$/, '$1-$2');
    } else {
      slug = s.replace('.', '-');
    }
    let html;
    try {
      html = await fetchUrl(`${BASE_URL}/radio_show/mrr-radio-${slug}/`);
    } catch {
      // Some .5 episodes use "mrrradio" slug (e.g. mrrradio1598-5)
      html = await fetchUrl(`${BASE_URL}/radio_show/mrrradio${slug}/`);
    }
    const m = html.match(/<img class="lazyload border"[^>]+data-srcset="([^"]+)"/);
    if (!m) return null;
    const urls = m[1].split(',').map((s) => s.trim().split(' ')[0]);
    return urls[urls.length - 1] || null;
  } catch {
    return null;
  }
}

// ── Parse tracklist from content:encoded (dl/dt/dd format) ───────────────────
function addTrack(tracks, artist, title, section, trackIndex) {
  artist = artist.trim();
  title = title.trim();
  if (artist.length > 0 && artist.length < 80 && title.length > 0 && title.length < 200) {
    tracks.push({ artist: artist.toUpperCase(), title, section, trackIndex });
    return trackIndex + 1;
  }
  return trackIndex;
}

function splitTrack(raw) {
  // Split on em-dash, en-dash, or " - " separator
  return raw.match(/^(.+?)\s*[\u2013\u2014]\s*(.+)$/) || raw.match(/^(.+?)\s+-\s+(.+)$/);
}

function parseTracklist(html) {
  const tracks = [];
  let currentSection = '';
  let trackIndex = 0;

  // Strip CDATA wrapper if present
  const content = html.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');

  // ── Format 1: <dl>/<dt>/<dd> (newer episodes) ────────────────────────────
  if (/<dl[^>]*>/i.test(content)) {
    const dlRe = /<dl[^>]*>([\s\S]*?)(?:<\/dl>|(?=<dl))/gi;
    let dlMatch;
    while ((dlMatch = dlRe.exec(content)) !== null) {
      const block = dlMatch[1];
      const dtMatch = block.match(/<dt[^>]*>([\s\S]*?)<\/dt>/i);
      if (dtMatch) {
        currentSection = decode(dtMatch[1].replace(/<[^>]+>/g, '').trim());
      }
      const ddRe = /<dd[^>]*>([\s\S]*?)(?:<\/dd>|<dd|$)/gi;
      let ddMatch;
      while ((ddMatch = ddRe.exec(block)) !== null) {
        const raw = decode(ddMatch[1].replace(/<[^>]+>/g, '').trim());
        const sep = splitTrack(raw);
        if (sep) trackIndex = addTrack(tracks, sep[1], sep[2], currentSection, trackIndex);
      }
    }
    if (tracks.length > 0) return tracks;
  }

  // ── Format 2: <strong> headers + plain ARTIST – Song lines (older episodes) ─
  const lines = content
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '\n__STRONG__$1__STRONG__\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p[^>]*>/gi, '\n').replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((l) => decode(l).trim())
    .filter((l) => l.length > 0);

  for (const line of lines) {
    if (line.startsWith('__STRONG__') && line.endsWith('__STRONG__')) {
      currentSection = line.slice(10, -10).trim();
      continue;
    }
    const sep = splitTrack(line);
    if (sep && !sep[1].startsWith('http') && !sep[1].match(/^\d{4}/)) {
      trackIndex = addTrack(tracks, sep[1], sep[2], currentSection, trackIndex);
    }
  }

  return tracks;
}

// ── Parse RSS page ────────────────────────────────────────────────────────────
function parseRssPage(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];

    // Title (no CDATA on MRR)
    const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
      block.match(/<title>([^<]*)<\/title>/))?.[1]?.trim() || '';

    const epNumMatch = title.match(/#(\d+(?:\.\d+)?)/);
    if (!epNumMatch) continue;
    let epNum = parseFloat(epNumMatch[1]);
    // Handle "Part 1" / "Part 2" suffixes on .5 episodes (e.g. #1583.5 Part 2 → 1583.52)
    const partMatch = title.match(/part\s*(\d)/i);
    if (partMatch) epNum = parseFloat(epNum.toFixed(1) + partMatch[1]);
    if (!epNum) continue;

    // Link
    const link = (block.match(/<link>([^<]+)<\/link>/) || [])[1]?.trim() || '';

    // Enclosure — use [^>]* to safely skip type="audio/mpeg" which contains /
    const enclosure = block.match(/<enclosure url="([^"]+)"[^>]*>/)?.[1] || '';
    if (!enclosure) continue;

    // Duration
    const durationRaw = (block.match(/<itunes:duration>([^<]+)<\/itunes:duration>/) || [])[1]?.trim() || '';
    let durationSecs = 0;
    if (durationRaw) {
      const parts = durationRaw.split(':').map(Number);
      if (parts.length === 3) durationSecs = parts[0] * 3600 + parts[1] * 60 + parts[2];
      else if (parts.length === 2) durationSecs = parts[0] * 60 + parts[1];
      else durationSecs = parts[0] || 0;
    }

    // Date
    const pubDate = (block.match(/<pubDate>([^<]+)<\/pubDate>/) || [])[1]?.trim() || '';
    const date = pubDate ? new Date(pubDate).toISOString().slice(0, 10) : '';

    // Host — "On this week's MRR Radio, <Name> plays..."
    const desc = (block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || [])[1] || '';
    const plainDesc = decode(desc.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
    // Extract host: grab consecutive Title-Case words after "MRR Radio with/,"
    // then strip trailing verb words (which may be capitalised on MRR)
    const HOST_VERBS = new Set([
      'plays','presents','begins','brings','hosts','spins','is','does','will',
      'has','was','takes','makes','goes','gives','looks','comes','sets','ends',
      'spends','runs','heads','picks','digs','wraps','walks','explores',
    ]);
    const hostMatch = plainDesc.match(/MRR Radio(?:,| with)\s+((?:[A-Z][a-zA-Z']+(?: (?=[A-Z]))?)+)/);
    let host = '';
    if (hostMatch) {
      const words = hostMatch[1].trim().split(/\s+/);
      while (words.length > 0 && HOST_VERBS.has(words[words.length - 1].toLowerCase())) {
        words.pop();
      }
      host = words.join(' ').replace(/[.,!?]+$/, '').trim();
    }
    // Extract description only — stop before tracklist.
    // Artist names in MRR tracklists are ALL-CAPS followed by em/en-dash or space-hyphen-space.
    const trackStart = plainDesc.match(/\b[A-Z][A-Z\-']*(?:[ ][A-Z][A-Z\-']*)* [-\u2013\u2014] [A-Z]/);
    let caption;
    if (trackStart) {
      const beforeTrack = plainDesc.slice(0, trackStart.index);
      const lastPunct = Math.max(
        beforeTrack.lastIndexOf(')'), beforeTrack.lastIndexOf('.'),
        beforeTrack.lastIndexOf('!'), beforeTrack.lastIndexOf('?'),
      );
      caption = (lastPunct >= 0 ? beforeTrack.slice(0, lastPunct + 1) : beforeTrack).trim().slice(0, 280);
    } else {
      caption = plainDesc.slice(0, 280);
    }

    // Tracklist from content:encoded
    const contentEncoded = (block.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/) || [])[1] || '';
    const tracks = contentEncoded ? parseTracklist(contentEncoded) : [];

    items.push({ epNum, date, host, caption, mp3Url: enclosure, durationSecs, link, tracks });
  }
  return items;
}

// ── Fetch RSS pages ───────────────────────────────────────────────────────────
async function fetchRssItems(targetCount) {
  const items = [];
  let page = 1;
  while (true) {
    const url = page === 1 ? RSS_BASE : `${RSS_BASE}?paged=${page}`;
    console.log(`  RSS page ${page}: ${url}`);
    let xml;
    try { xml = await fetchUrl(url); } catch { break; } // 404 = no more pages
    const pageItems = parseRssPage(xml);
    console.log(`    → ${pageItems.length} episodes parsed`);
    if (pageItems.length === 0) break;
    items.push(...pageItems);
    if (!MODE_ALL && items.length >= targetCount) break;
    page++;
    await delay(400);
  }
  return items;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(AUDIO_DIR, { recursive: true });

  // Load existing data
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

  const MODE_FORCE = args.includes('--force');
  const toImport = rssItems.filter((ep) => {
    if (SINCE_NUM && ep.epNum <= SINCE_NUM) return false;
    if (existingIds.has(ep.epNum) && !MODE_FORCE) return false;
    return true;
  });

  if (toImport.length === 0) {
    console.log('No new episodes to import.');
    return;
  }

  console.log(`\n── Importing ${toImport.length} episodes ──`);

  const newEpisodes = [];
  for (const ep of toImport) {
    const episode = {
      id: ep.epNum,
      date: ep.date,
      host: ep.host,
      caption: ep.caption,
      thumbnailUrl: await fetchThumbnail(ep.epNum),
      mp3Url: ep.mp3Url,
      durationSecs: ep.durationSecs,
      trackCount: ep.tracks.length,
      localAudio: false,
      tracks: ep.tracks.map((t, idx) => ({
        id: Math.round(ep.epNum * 10) * 1000 + idx,
        episodeId: ep.epNum,
        ...t,
      })),
    };

    if (MODE_DOWNLOAD && ep.mp3Url) {
      const audioPath = resolve(AUDIO_DIR, `mrr-radio-${ep.epNum}.mp3`);
      if (!existsSync(audioPath)) {
        process.stdout.write(`  Downloading #${ep.epNum}... `);
        try {
          await downloadBinary(ep.mp3Url, audioPath);
          episode.localAudio = true;
          console.log('done');
        } catch (err) {
          console.log(`failed: ${err.message}`);
        }
      } else {
        episode.localAudio = true;
      }
    }

    console.log(`  #${ep.epNum} ${ep.date}  host="${ep.host}"  tracks=${ep.tracks.length}`);
    newEpisodes.push(episode);

    // Checkpoint every 25 new episodes — save progress to disk
    if (newEpisodes.length % 25 === 0) {
      const checkpoint = [
        ...newEpisodes,
        ...existing.filter((e) => !newEpisodes.find((n) => n.id === e.id)),
      ].sort((a, b) => b.id - a.id);
      writeFileSync(OUTPUT_FILE, JSON.stringify({ generated: new Date().toISOString(), count: checkpoint.length, episodes: checkpoint }, null, 2));
      const ckTracks = checkpoint.reduce((s, e) => s + (e.tracks?.length || 0), 0);
      console.log(`  ── checkpoint: ${checkpoint.length} episodes, ${ckTracks} tracks saved ──`);
    }

    if (MODE_SLOW) await delay(5000);
  }

  const merged = [
    ...newEpisodes,
    ...existing.filter((e) => !newEpisodes.find((n) => n.id === e.id)),
  ].sort((a, b) => b.id - a.id);

  const output = {
    generated: new Date().toISOString(),
    count: merged.length,
    episodes: merged,
  };

  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  // Write lightweight version file for update checking
  const versionFile = resolve(DATA_DIR, 'episodes-version.json');
  writeFileSync(versionFile, JSON.stringify({ generated: output.generated, count: output.count }));

  console.log(`\n✓ ${merged.length} episodes written to public/data/episodes.json`);
  const totalTracks = merged.reduce((s, e) => s + (e.tracks?.length || 0), 0);
  console.log(`  ${totalTracks} total tracks`);
}

main().catch((err) => { console.error('Scraper failed:', err); process.exit(1); });
