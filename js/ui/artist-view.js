/**
 * artist-view.js — Slide-in panel showing episodes for a specific artist
 *
 * Slides in from the right via CSS transform transition.
 * Uses the same episode card format as the main list.
 */

import { getEpisodesByArtist, getEpisodes } from '../db.js';
import { renderList } from './episode-list.js';

export class ArtistView {
  /**
   * @param {function} onEpisodeClick  — (episodeId) => void  (plays the episode)
   * @param {Set}      playedSet       — live reference to played episode IDs
   */
  constructor(onEpisodeClick, playedSet) {
    this._onEpisodeClick = onEpisodeClick;
    this._playedSet = playedSet;

    this._panel     = document.getElementById('artist-view');
    this._nameEl    = document.getElementById('artist-name');
    this._listEl    = document.getElementById('artist-episode-list');
    this._backBtn   = document.getElementById('artist-back-btn');

    this._backBtn.addEventListener('click', () => this.close());

    // Swipe back from left edge
    this._bindSwipeBack();
  }

  /** Open the panel for a given artist name */
  async open(artistName) {
    this._nameEl.textContent = artistName;
    this._listEl.replaceChildren(); // clear while loading

    // Show immediately
    this._panel.classList.add('open');
    this._panel.setAttribute('aria-hidden', 'false');

    // Load episodes
    const episodeIds = await getEpisodesByArtist(artistName);
    const episodes = episodeIds.length
      ? await getEpisodes({ episodeIds })
      : [];

    if (episodes.length === 0) {
      const msg = document.createElement('p');
      msg.style.cssText = 'padding:24px 16px;color:var(--muted);font-size:14px;';
      msg.textContent = 'No episodes found.';
      this._listEl.appendChild(msg);
    } else {
      renderList(this._listEl, episodes, this._playedSet, (id) => {
        this._onEpisodeClick(id);
        // Keep artist view open so user can go back to it
      });
    }
  }

  close() {
    this._panel.classList.remove('open');
    this._panel.setAttribute('aria-hidden', 'true');
  }

  get isOpen() {
    return this._panel.classList.contains('open');
  }

  _bindSwipeBack() {
    let startX = null;
    const panel = this._panel;

    panel.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
    }, { passive: true });

    panel.addEventListener('touchmove', (e) => {
      if (startX === null) return;
      const delta = e.touches[0].clientX - startX;
      if (delta > 0) {
        panel.style.transform = `translateX(${delta}px)`;
      }
    }, { passive: true });

    panel.addEventListener('touchend', (e) => {
      if (startX === null) return;
      const delta = e.changedTouches[0].clientX - startX;
      panel.style.transform = '';
      if (delta > 100) this.close();
      startX = null;
    }, { passive: true });
  }
}
