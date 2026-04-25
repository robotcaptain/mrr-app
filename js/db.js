/**
 * db.js — IndexedDB helpers for MRR Radio
 *
 * Stores:
 *   episodes  (keyPath: id)          — episode metadata
 *   tracks    (keyPath: id)          — individual tracks, indexed by episodeId + artist
 *   playback  (keyPath: episodeId)   — timestamp + played state
 */

const DB_NAME = 'mrr-radio';
const DB_VERSION = 1;

let _db = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;

      // episodes store
      if (!db.objectStoreNames.contains('episodes')) {
        db.createObjectStore('episodes', { keyPath: 'id' });
      }

      // tracks store with compound indexes
      if (!db.objectStoreNames.contains('tracks')) {
        const tracks = db.createObjectStore('tracks', { keyPath: 'id' });
        tracks.createIndex('episodeId', 'episodeId', { unique: false });
        tracks.createIndex('artist', 'artist', { unique: false });
        tracks.createIndex('title', 'title', { unique: false });
      }

      // playback store
      if (!db.objectStoreNames.contains('playback')) {
        db.createObjectStore('playback', { keyPath: 'episodeId' });
      }
    };

    req.onsuccess = (event) => {
      _db = event.target.result;
      resolve(_db);
    };

    req.onerror = (event) => {
      reject(new Error(`IndexedDB open failed: ${event.target.error}`));
    };
  });
}

// ─── Generic helpers ──────────────────────────────────────────────────────────

function txGet(storeName, key) {
  return openDB().then((db) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    })
  );
}

function txPut(storeName, value) {
  return openDB().then((db) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).put(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    })
  );
}

function txGetAll(storeName) {
  return openDB().then((db) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    })
  );
}

function txPutBulk(storeName, items) {
  return openDB().then((db) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      if (items.length === 0) return resolve(0);
      for (const item of items) {
        const req = store.put(item);
        req.onerror = () => reject(req.error);
      }
      tx.oncomplete = () => resolve(items.length);
      tx.onerror = () => reject(tx.error);
    })
  );
}

function txCount(storeName) {
  return openDB().then((db) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    })
  );
}

// ─── Episodes ─────────────────────────────────────────────────────────────────

export function getEpisodeCount() {
  return txCount('episodes');
}

export function getEpisode(id) {
  return txGet('episodes', id);
}

/**
 * Returns episodes sorted newest-first.
 * Optional filters: { host, year, episodeIds }
 */
export async function getEpisodes({ host, year, episodeIds } = {}) {
  const all = await txGetAll('episodes');
  let results = all;

  if (episodeIds) {
    const set = new Set(episodeIds);
    results = results.filter((e) => set.has(e.id));
  }

  if (host) {
    results = results.filter((e) => e.host === host);
  }

  if (year) {
    results = results.filter((e) => e.date && e.date.startsWith(String(year)));
  }

  // Sort newest first (highest episode number = newest)
  results.sort((a, b) => b.id - a.id);
  return results;
}

export function putEpisodes(episodes) {
  return txPutBulk('episodes', episodes);
}

/** Returns sorted unique host names */
export async function getHosts() {
  const all = await txGetAll('episodes');
  const hosts = [...new Set(all.map((e) => e.host).filter(Boolean))];
  hosts.sort((a, b) => a.localeCompare(b));
  return hosts;
}

/** Returns sorted unique years, newest first */
export async function getYears() {
  const all = await txGetAll('episodes');
  const years = [...new Set(all.map((e) => e.date?.slice(0, 4)).filter(Boolean))];
  years.sort((a, b) => Number(b) - Number(a));
  return years;
}

// ─── Tracks ───────────────────────────────────────────────────────────────────

export function getTracks(episodeId) {
  return openDB().then((db) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction('tracks', 'readonly');
      const idx = tx.objectStore('tracks').index('episodeId');
      const req = idx.getAll(episodeId);
      req.onsuccess = () => {
        const sorted = (req.result || []).sort((a, b) => a.trackIndex - b.trackIndex);
        resolve(sorted);
      };
      req.onerror = () => reject(req.error);
    })
  );
}

export function putTracks(tracks) {
  return txPutBulk('tracks', tracks);
}

/**
 * Full-text search across artist + title (substring match).
 * Less efficient than index search; used for song title search.
 * Returns unique episodeIds.
 */
export async function searchTracks(query) {
  if (!query) return [];
  const q = query.toLowerCase().trim();
  const all = await txGetAll('tracks');
  const episodeIds = new Set();
  for (const track of all) {
    if (
      track.artist?.toLowerCase().includes(q) ||
      track.title?.toLowerCase().includes(q)
    ) {
      episodeIds.add(track.episodeId);
    }
  }
  return [...episodeIds];
}

/**
 * Get all episodes that contain a specific artist (exact normalized match).
 */
export async function getEpisodesByArtist(artistName) {
  const normalized = artistName.toUpperCase().trim();
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction('tracks', 'readonly');
    const idx = tx.objectStore('tracks').index('artist');
    const req = idx.getAll(normalized);
    req.onsuccess = () => {
      const episodeIds = [...new Set((req.result || []).map((t) => t.episodeId))];
      resolve(episodeIds);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get all tracks by a specific artist, across all episodes.
 * Returns [{ episodeId, title }]
 */
export function getTracksByArtist(artistName) {
  const normalized = artistName.toUpperCase().trim();
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction('tracks', 'readonly');
    const req = tx.objectStore('tracks').index('artist').getAll(normalized);
    req.onsuccess = () => {
      resolve((req.result || []).map((t) => ({ episodeId: t.episodeId, title: t.title })));
    };
    req.onerror = () => reject(req.error);
  }));
}

/**
 * Get all artists with episode counts, sorted alphabetically.
 * Returns [{ artist, episodeCount }]
 */
export function getAllArtists() {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction('tracks', 'readonly');
    const req = tx.objectStore('tracks').index('artist').openCursor();
    const map = new Map();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const { artist, episodeId } = cursor.value;
        if (!artist) { cursor.continue(); return; }
        if (!map.has(artist)) map.set(artist, new Set());
        map.get(artist).add(episodeId);
        cursor.continue();
      } else {
        resolve(
          [...map.entries()]
            .map(([artist, eps]) => ({ artist, episodeCount: eps.size }))
            .sort((a, b) => a.artist.localeCompare(b.artist))
        );
      }
    };
    req.onerror = () => reject(req.error);
  }));
}

// ─── Playback ─────────────────────────────────────────────────────────────────

export function getPlayback(episodeId) {
  return txGet('playback', episodeId);
}

export function getAllPlayback() {
  return txGetAll('playback');
}

export function setPlayback(record) {
  return txPut('playback', record);
}

/**
 * Merge partial playback update without overwriting other fields.
 */
export async function updatePlayback(episodeId, updates) {
  const existing = (await getPlayback(episodeId)) || {
    episodeId,
    timestamp: 0,
    played: false,
    lastPlayed: null,
  };
  return setPlayback({ ...existing, ...updates, episodeId });
}
