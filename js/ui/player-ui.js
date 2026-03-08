/**
 * player-ui.js — Mini player bar + expanded player sheet
 *
 * Wires the Player engine to the DOM elements defined in index.html.
 * Handles:
 *   - Mini player visibility, thumbnail, title, progress bar
 *   - Expanded sheet open/close (CSS transition via .open class)
 *   - Scrubber sync (display + user scrubbing)
 *   - Skip ±15s buttons
 *   - Track list rendering with artist-click callbacks
 */

import { getTracks } from '../db.js';

function fmtTime(secs) {
  if (!secs || !isFinite(secs)) return '0:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function setThumb(el, ep) {
  el.replaceChildren();
  if (ep?.thumbnailUrl) {
    const img = document.createElement('img');
    img.src = ep.thumbnailUrl;
    img.alt = '';
    img.onerror = () => img.remove();
    el.appendChild(img);
  }
}

export class PlayerUI {
  /**
   * @param {Player}   player         — Player engine instance
   * @param {function} onArtistClick  — (artistName) => void
   */
  constructor(player, onArtistClick) {
    this._player = player;
    this._onArtistClick = onArtistClick;
    this._currentEpisode = null;
    this._isScrubbing = false;
    this._sheetOpen = false;

    // ── Element refs ──────────────────────────────────────────────────────
    this._miniPlayer   = document.getElementById('mini-player');
    this._miniThumb    = document.getElementById('mini-thumb');
    this._miniTitle    = document.getElementById('mini-episode-title');
    this._miniHost     = document.getElementById('mini-host');
    this._miniPlayBtn  = document.getElementById('mini-play-btn');
    this._miniProgress = this._miniPlayer.querySelector('.mini-player-progress');
    this._miniScrubber = document.getElementById('mini-scrubber');

    this._sheet        = document.getElementById('player-sheet');
    this._backdrop     = document.getElementById('sheet-backdrop');
    this._sheetArt     = document.getElementById('sheet-art');
    this._sheetEpNum   = document.getElementById('sheet-episode-num');
    this._sheetHost    = document.getElementById('sheet-host');
    this._sheetCaption = document.getElementById('sheet-caption');
    this._sheetScrubber  = document.getElementById('sheet-scrubber');
    this._currentTimeEl  = document.getElementById('current-time');
    this._totalTimeEl    = document.getElementById('total-time');
    this._sheetPlayBtn   = document.getElementById('sheet-play-btn');
    this._skipBackBtn    = document.getElementById('skip-back-btn');
    this._skipFwdBtn     = document.getElementById('skip-fwd-btn');
    this._sheetTracklist = document.getElementById('sheet-tracklist');
    this._sheetCloseBtn  = document.getElementById('sheet-close-btn');

    this._bindUI();

    // Subscribe to player state changes
    this._player.subscribe((state) => this._onPlayerState(state));
  }

  // ── Load episode into player ───────────────────────────────────────────────

  setEpisode(episode) {
    this._currentEpisode = episode;
    document.body.classList.add('has-player');
    this._updateMiniInfo(episode);
    this._updateSheetInfo(episode);
    this._loadTracklist(episode.id);
  }

  // ── Sheet open/close ──────────────────────────────────────────────────────

  openSheet() {
    this._sheetOpen = true;
    this._sheet.classList.add('open');
    this._sheet.setAttribute('aria-hidden', 'false');
    this._backdrop.hidden = false;
    requestAnimationFrame(() => this._backdrop.classList.add('visible'));
    document.body.style.overflow = 'hidden';
  }

  closeSheet() {
    this._sheetOpen = false;
    this._sheet.classList.remove('open');
    this._sheet.setAttribute('aria-hidden', 'true');
    this._backdrop.classList.remove('visible');
    document.body.style.overflow = '';
    this._backdrop.addEventListener('transitionend', () => {
      if (!this._sheetOpen) this._backdrop.hidden = true;
    }, { once: true });
  }

  // ── Player state updates ───────────────────────────────────────────────────

  _onPlayerState(state) {
    if (!state.episodeId) return;

    // Show mini player
    this._miniPlayer.hidden = false;

    // Play/pause icons
    this._setPlayingIcons(state.isPlaying);

    // Progress
    const pct = state.progress * 100;
    this._miniProgress.style.setProperty('--progress', `${pct.toFixed(1)}%`);

    // Scrubbers — only update if user isn't actively dragging
    if (!this._isScrubbing) {
      const val = state.duration > 0 ? (state.currentTime / state.duration) * 100 : 0;
      this._miniScrubber.value = val;
      this._sheetScrubber.value = val;

      // Update CSS custom property for webkit track fill
      const pctStr = `${val.toFixed(1)}%`;
      this._sheetScrubber.style.setProperty('--pct', pctStr);

      this._currentTimeEl.textContent = fmtTime(state.currentTime);
      this._totalTimeEl.textContent = fmtTime(state.duration);
    }
  }

  _setPlayingIcons(isPlaying) {
    for (const btn of [this._miniPlayBtn, this._sheetPlayBtn]) {
      btn.classList.toggle('is-playing', isPlaying);
    }
  }

  // ── Info updates ──────────────────────────────────────────────────────────

  _updateMiniInfo(ep) {
    this._miniTitle.textContent = `#${ep.id}`;
    this._miniHost.textContent = ep.host || '';
    setThumb(this._miniThumb, ep);
  }

  _updateSheetInfo(ep) {
    this._sheetEpNum.textContent = `MRR RADIO #${ep.id}`;
    this._sheetHost.textContent = ep.host || '';
    this._sheetCaption.textContent = ep.caption || '';

    // Art
    this._sheetArt.replaceChildren();
    if (ep.thumbnailUrl) {
      const img = document.createElement('img');
      img.src = ep.thumbnailUrl;
      img.alt = `MRR Radio #${ep.id}`;
      img.onerror = () => { img.remove(); this._sheetArt.appendChild(this._buildArtPlaceholder(ep.id)); };
      this._sheetArt.appendChild(img);
    } else {
      this._sheetArt.appendChild(this._buildArtPlaceholder(ep.id));
    }
  }

  _buildArtPlaceholder(id) {
    const div = document.createElement('div');
    div.className = 'sheet-art-placeholder';
    const strong = document.createElement('strong');
    strong.textContent = `#${id}`;
    const label = document.createElement('div');
    label.textContent = 'MRR RADIO';
    div.appendChild(strong);
    div.appendChild(label);
    return div;
  }

  // ── Tracklist ─────────────────────────────────────────────────────────────

  async _loadTracklist(episodeId) {
    this._sheetTracklist.replaceChildren();
    const tracks = await getTracks(episodeId);

    if (tracks.length === 0) {
      const msg = document.createElement('div');
      msg.className = 'track-item';
      msg.textContent = 'No tracklist available.';
      this._sheetTracklist.appendChild(msg);
      return;
    }

    let lastSection = null;
    const frag = document.createDocumentFragment();

    for (const track of tracks) {
      if (track.section && track.section !== lastSection) {
        lastSection = track.section;
        const hdr = document.createElement('div');
        hdr.className = 'track-section-header';
        hdr.textContent = track.section;
        frag.appendChild(hdr);
      }

      const item = document.createElement('div');
      const hasTime = track.startTime !== undefined && track.startTime !== null;
      item.className = hasTime ? 'track-item has-timestamp' : 'track-item';

      // Timestamp badge (right-aligned) — shown when track has a start time
      if (hasTime) {
        const ts = document.createElement('span');
        ts.className = 'track-timestamp';
        ts.textContent = fmtTime(track.startTime);
        item.appendChild(ts);
        item.addEventListener('click', (e) => {
          if (e.target.closest('.track-artist')) return; // artist click handled below
          this._player.seek(track.startTime);
        });
      }

      const artistEl = document.createElement('span');
      artistEl.className = 'track-artist';
      artistEl.textContent = track.artist;
      artistEl.setAttribute('role', 'button');
      artistEl.setAttribute('tabindex', '0');
      artistEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this._onArtistClick(track.artist);
      });
      artistEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this._onArtistClick(track.artist);
        }
      });

      const sep = document.createTextNode(' – ');

      const titleEl = document.createElement('span');
      titleEl.className = 'track-title';
      titleEl.textContent = track.title;

      item.appendChild(artistEl);
      item.appendChild(sep);
      item.appendChild(titleEl);
      frag.appendChild(item);
    }

    this._sheetTracklist.appendChild(frag);
  }

  // ── UI event binding ──────────────────────────────────────────────────────

  _bindUI() {
    // Mini player: tap content area → expand sheet
    document.getElementById('mini-player-expand').addEventListener('click', (e) => {
      if (e.target.closest('.mini-play-btn')) return; // handled separately
      this.openSheet();
    });

    // Mini expand chevron button
    this._miniPlayer.querySelector('.mini-expand-btn').addEventListener('click', () => {
      this.openSheet();
    });

    // Mini play/pause
    this._miniPlayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._player.toggle();
    });

    // Sheet close
    this._sheetCloseBtn.addEventListener('click', () => this.closeSheet());
    this._backdrop.addEventListener('click', () => this.closeSheet());

    // Sheet play/pause
    this._sheetPlayBtn.addEventListener('click', () => this._player.toggle());

    // Skip buttons
    this._skipBackBtn.addEventListener('click', () => this._player.seekRelative(-15));
    this._skipFwdBtn.addEventListener('click', () => this._player.seekRelative(15));

    // Sheet scrubber
    this._sheetScrubber.addEventListener('input', () => {
      this._isScrubbing = true;
      const pct = this._sheetScrubber.value / 100;
      const dur = this._player.duration;
      if (dur > 0) {
        this._currentTimeEl.textContent = fmtTime(pct * dur);
      }
      this._sheetScrubber.style.setProperty('--pct', `${this._sheetScrubber.value}%`);
    });
    this._sheetScrubber.addEventListener('change', () => {
      const pct = this._sheetScrubber.value / 100;
      this._player.seek(pct * this._player.duration);
      this._isScrubbing = false;
    });

    // Swipe-down to close sheet
    this._bindSwipeClose();
  }

  _bindSwipeClose() {
    let startY = null;
    const sheet = this._sheet;

    sheet.addEventListener('touchstart', (e) => {
      // Don't intercept touches on the scrollable tracklist
      if (e.target.closest('.tracklist-section')) return;
      startY = e.touches[0].clientY;
    }, { passive: true });

    sheet.addEventListener('touchmove', (e) => {
      if (startY === null) return;
      const delta = e.touches[0].clientY - startY;
      if (delta > 0) {
        sheet.style.transform = `translateY(${delta}px)`;
      }
    }, { passive: true });

    sheet.addEventListener('touchend', (e) => {
      if (startY === null) return;
      const delta = e.changedTouches[0].clientY - startY;
      sheet.style.transform = '';
      if (delta > 120) {
        this.closeSheet();
      }
      startY = null;
    }, { passive: true });
  }
}
