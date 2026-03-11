/**
 * data-loader.js — Load episodes.json → IndexedDB
 *
 * On first run: imports all episodes + tracks from the JSON file.
 * On subsequent runs: skips episodes already present (by id).
 * Exposes a sync() function for manually fetching new episodes in-app.
 * Exposes checkForUpdate() to compare local vs remote version cheaply.
 */

import { openDB, getEpisodeCount, getEpisodes, getEpisode, putEpisodes, putTracks } from './db.js';

const EPISODES_JSON = '/public/data/episodes.json';
const EPISODES_JSON_ALT = '/data/episodes.json';
const VERSION_JSON = '/public/data/episodes-version.json';
const VERSION_JSON_ALT = '/data/episodes-version.json';
const DATA_VERSION_KEY = 'mrr-data-version';

let _loadPromise = null;

/**
 * Initialise DB and import data from episodes.json if needed.
 * Safe to call multiple times — returns same promise after first call.
 * @param {(msg: string) => void} onProgress  - optional progress callback
 */
export function init(onProgress) {
  if (_loadPromise) return _loadPromise;
  _loadPromise = _run(onProgress);
  return _loadPromise;
}

async function _run(onProgress) {
  await openDB();

  const count = await getEpisodeCount();
  if (count > 0) {
    onProgress?.(`${count} episodes loaded`);
    return { count, imported: 0 };
  }

  onProgress?.('Fetching episode data...');

  let data;
  try {
    data = await _fetchJson(EPISODES_JSON);
  } catch {
    try {
      data = await _fetchJson(EPISODES_JSON_ALT);
    } catch (err) {
      throw new Error(`Could not load episodes.json: ${err.message}`);
    }
  }

  const episodes = Array.isArray(data) ? data : (data.episodes ?? []);
  if (episodes.length === 0) throw new Error('episodes.json contains no episodes');

  onProgress?.(`Importing ${episodes.length} episodes...`);

  // Separate tracks from episode objects for their own store
  const episodeRows = [];
  const trackRows = [];

  for (const ep of episodes) {
    const { tracks, ...epData } = ep;
    episodeRows.push(epData);
    if (Array.isArray(tracks)) {
      for (const t of tracks) {
        trackRows.push(t);
      }
    }
  }

  // Batch import in chunks to avoid long transactions
  const CHUNK = 100;
  for (let i = 0; i < episodeRows.length; i += CHUNK) {
    await putEpisodes(episodeRows.slice(i, i + CHUNK));
    if (episodeRows.length > CHUNK) {
      onProgress?.(`Importing episodes ${i + 1}–${Math.min(i + CHUNK, episodeRows.length)}...`);
    }
  }

  for (let i = 0; i < trackRows.length; i += CHUNK) {
    await putTracks(trackRows.slice(i, i + CHUNK));
  }

  // Store the version we just imported
  const version = data.generated ?? null;
  if (version) localStorage.setItem(DATA_VERSION_KEY, version);

  onProgress?.(`${episodeRows.length} episodes ready`);
  return { count: episodeRows.length, imported: episodeRows.length };
}

/**
 * Check if a newer version of episodes.json is available.
 * Fetches only the tiny version file (~60 bytes).
 * @returns {Promise<boolean>} true if update available
 */
export async function checkForUpdate() {
  const localVersion = localStorage.getItem(DATA_VERSION_KEY);
  if (!localVersion) return false; // first run, init() will handle it

  let remote;
  try {
    remote = await _fetchJson(`${VERSION_JSON}?t=${Date.now()}`);
  } catch {
    try {
      remote = await _fetchJson(`${VERSION_JSON_ALT}?t=${Date.now()}`);
    } catch {
      return false;
    }
  }

  return remote.generated && remote.generated !== localVersion;
}

async function _fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Sync: fetch episodes.json again and import any episodes not already in DB.
 * Called from the ⟳ sync button.
 * @param {(msg: string) => void} onProgress
 */
export async function sync(onProgress) {
  onProgress?.('Checking for new episodes...');

  let data;
  try {
    // Cache-bust to get fresh data
    const url = `${EPISODES_JSON}?t=${Date.now()}`;
    data = await _fetchJson(url);
  } catch {
    try {
      const url = `${EPISODES_JSON_ALT}?t=${Date.now()}`;
      data = await _fetchJson(url);
    } catch (err) {
      throw new Error(`Sync failed: ${err.message}`);
    }
  }

  const episodes = Array.isArray(data) ? data : (data.episodes ?? []);

  // Find which episode IDs we already have
  const existing = await getEpisodes();
  const existingIds = new Set(existing.map((e) => e.id));

  const newEpisodes = episodes.filter((e) => !existingIds.has(e.id));

  // Also refresh indexed episodes that changed since last import
  const newVersion = data.generated ?? null;
  const lastVersion = localStorage.getItem(DATA_VERSION_KEY);
  const dataChanged = newVersion && newVersion !== lastVersion;

  const toRefresh = dataChanged
    ? episodes.filter((ep) => existingIds.has(ep.id))
    : [];

  if (newEpisodes.length === 0 && toRefresh.length === 0) {
    onProgress?.('Already up to date');
    if (newVersion) localStorage.setItem(DATA_VERSION_KEY, newVersion);
    return { added: 0 };
  }

  const allToWrite = [...newEpisodes, ...toRefresh];
  if (newEpisodes.length > 0) onProgress?.(`Adding ${newEpisodes.length} new episodes...`);
  if (toRefresh.length > 0) onProgress?.(`Refreshing ${toRefresh.length} episode(s)...`);

  const episodeRows = [];
  const trackRows = [];
  for (const ep of allToWrite) {
    const { tracks, ...epData } = ep;
    episodeRows.push(epData);
    if (Array.isArray(tracks)) trackRows.push(...tracks);
  }

  await putEpisodes(episodeRows);
  if (trackRows.length) await putTracks(trackRows);

  if (newEpisodes.length > 0) onProgress?.(`Added ${newEpisodes.length} new episodes`);
  if (toRefresh.length > 0) onProgress?.(`Refreshed ${toRefresh.length} episodes`);
  if (newVersion) localStorage.setItem(DATA_VERSION_KEY, newVersion);
  return { added: newEpisodes.length, refreshed: toRefresh.length };
}
