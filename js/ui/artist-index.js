/**
 * artist-index.js — Full-screen artist list overlay
 *
 * Opens when the search bar is focused. Shows all artists sorted
 * alphabetically with episode counts. Filters as the user types.
 * Tapping an artist calls onArtistSelect(artistName).
 */

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
