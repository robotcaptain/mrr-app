# Artist Index Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When the user taps the search bar, show a full-screen scrollable artist index overlay; typing filters it; tapping an artist opens the existing ArtistView panel.

**Architecture:** New `ArtistIndex` component owns the overlay DOM and filtering logic. `getAllArtists()` added to `db.js` builds a sorted list of `{ artist, episodeCount }` from IndexedDB. `app.js` wires the search bar focus event to open the overlay and input events to either filter the overlay (when open) or trigger existing episode search (when overlay is closed).

**Tech Stack:** Vanilla JS ESM, IndexedDB (via existing db.js), no build step.

---

### Task 1: Add getAllArtists() to db.js

**Files:**
- Modify: `js/db.js`

**Step 1: Add the export after getEpisodesByArtist (around line 263)**

```js
export async function getAllArtists() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tracks', 'readonly');
    const req = tx.objectStore('tracks').index('artist').openCursor();
    const map = new Map();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const { artist, episodeId } = cursor.value;
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
  });
}
```

**Step 2: Commit**
```bash
git add js/db.js && git commit -m "feat: add getAllArtists() to db.js"
```

---

### Task 2: Create ArtistIndex component

**Files:**
- Create: `js/ui/artist-index.js`

```js
import { getAllArtists } from '../db.js';

export class ArtistIndex {
  constructor({ overlayEl, listEl, onArtistSelect }) {
    this._overlayEl = overlayEl;
    this._listEl = listEl;
    this._onArtistSelect = onArtistSelect;
    this._artists = null;
  }

  async open() {
    if (!this._artists) {
      this._artists = await getAllArtists();
    }
    this._render(this._artists);
    this._overlayEl.hidden = false;
  }

  close() {
    this._overlayEl.hidden = true;
  }

  get isOpen() {
    return !this._overlayEl.hidden;
  }

  filter(query) {
    if (!this._artists) return;
    const q = query.toLowerCase();
    const filtered = q
      ? this._artists.filter((a) => a.artist.toLowerCase().includes(q))
      : this._artists;
    this._render(filtered);
  }

  _render(artists) {
    // Clear list using DOM (not innerHTML) to avoid XSS
    while (this._listEl.firstChild) this._listEl.removeChild(this._listEl.firstChild);

    if (artists.length === 0) {
      const msg = document.createElement('div');
      msg.className = 'artist-index-empty';
      msg.textContent = 'No artists found';
      this._listEl.appendChild(msg);
      return;
    }

    for (const { artist, episodeCount } of artists) {
      const row = document.createElement('button');
      row.className = 'artist-index-row';

      const name = document.createElement('span');
      name.className = 'artist-index-name';
      name.textContent = artist;
      row.appendChild(name);

      if (episodeCount > 1) {
        const count = document.createElement('span');
        count.className = 'artist-index-count';
        count.textContent = `(${episodeCount})`;
        row.appendChild(count);
      }

      row.addEventListener('click', () => this._onArtistSelect(artist));
      this._listEl.appendChild(row);
    }
  }
}
```

**Step 2: Commit**
```bash
git add js/ui/artist-index.js && git commit -m "feat: add ArtistIndex component"
```

---

### Task 3: Add overlay HTML to index.html

**Files:**
- Modify: `index.html`

**Step 1: Add cancel button inside .search-wrap (after #search-clear, line 47)**

```html
<button id="search-cancel" class="search-cancel" hidden aria-label="Cancel">Cancel</button>
```

**Step 2: Add overlay div between #filter-bar and #app-main (after line 57)**

```html
<!-- Artist index overlay -->
<div id="artist-index-overlay" hidden>
  <div id="artist-index-list"></div>
</div>
```

**Step 3: Commit**
```bash
git add index.html && git commit -m "feat: add artist index overlay HTML"
```

---

### Task 4: Add CSS for the overlay

**Files:**
- Modify: `app.css`

**Step 1: Append to end of app.css**

```css
/* Artist Index Overlay */
#artist-index-overlay {
  position: fixed;
  top: calc(var(--header-h) + env(safe-area-inset-top, 0px) + var(--filter-h));
  left: 0; right: 0;
  bottom: calc(var(--player-h) + var(--safe-bottom));
  background: var(--bg);
  z-index: 85;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.artist-index-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  gap: 8px;
}
.artist-index-row:active { background: var(--surface); }
.artist-index-name { font-size: 14px; font-weight: 500; flex: 1; }
.artist-index-count { font-size: 12px; color: var(--muted); flex-shrink: 0; }
.artist-index-empty {
  padding: 32px 16px;
  color: var(--muted);
  font-size: 14px;
  text-align: center;
}
.search-cancel {
  font-size: 14px;
  color: var(--muted);
  padding: 0 4px 0 8px;
  flex-shrink: 0;
  white-space: nowrap;
}
```

**Step 2: Commit**
```bash
git add app.css && git commit -m "feat: add artist index overlay styles"
```

---

### Task 5: Wire up in app.js

**Files:**
- Modify: `js/app.js`

**Step 1: Add import at top of file**

```js
import { ArtistIndex } from './ui/artist-index.js';
```

**Step 2: Add DOM refs (after existing refs block)**

```js
const searchInput    = document.getElementById('search-input');
const searchCancel   = document.getElementById('search-cancel');
const artistIndexEl  = document.getElementById('artist-index-overlay');
const artistIndexList = document.getElementById('artist-index-list');
```

**Step 3: Instantiate ArtistIndex (after artistView instantiation)**

```js
const artistIndex = new ArtistIndex({
  overlayEl: artistIndexEl,
  listEl: artistIndexList,
  onArtistSelect: (name) => {
    closeArtistIndex();
    handleArtistClick(name);
  },
});
```

**Step 4: Add open/close helpers and event listeners (after filters instantiation)**

```js
function openArtistIndex() {
  searchCancel.hidden = false;
  document.getElementById('search-clear').hidden = true;
  artistIndex.open();
}

function closeArtistIndex() {
  searchCancel.hidden = true;
  searchInput.value = '';
  searchInput.blur();
  artistIndex.close();
}

searchInput.addEventListener('focus', () => openArtistIndex());
searchCancel.addEventListener('click', () => closeArtistIndex());
searchInput.addEventListener('input', () => {
  if (artistIndex.isOpen) artistIndex.filter(searchInput.value.trim());
});
```

**Step 5: Commit and push**
```bash
git add js/app.js && git commit -m "feat: wire artist index overlay to search bar"
git push
```

---

### Verification checklist
- Tap search bar → overlay appears with full sorted artist list
- Type a few letters → list filters live
- Tap an artist → overlay closes, artist panel opens
- Tap Cancel → overlay closes, search bar clears, episode list unchanged
- After cancel, type something → existing episode search still works
