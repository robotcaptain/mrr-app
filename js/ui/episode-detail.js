/**
 * episode-detail.js — Right-column episode detail view
 *
 * Shows episode artwork, metadata, "Play Episode" button, and tracklist.
 * Does NOT control playback — emits callbacks for play and artist clicks.
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

export class EpisodeDetail {
  constructor(containerEl, { onPlay, onArtistClick }) {
    this._el = containerEl;
    this._onPlay = onPlay;
    this._onArtistClick = onArtistClick;
    this._currentEpisode = null;
  }

  get episodeId() {
    return this._currentEpisode?.id ?? null;
  }

  async show(episode) {
    this._currentEpisode = episode;
    this._el.replaceChildren();

    if (!episode) {
      this._renderEmpty();
      return;
    }

    this._renderDetail(episode);
    await this._renderTracklist(episode.id);
  }

  clear() {
    this._currentEpisode = null;
    this._el.replaceChildren();
    this._renderEmpty();
  }

  _renderEmpty() {
    const div = document.createElement('div');
    div.className = 'detail-empty';
    div.textContent = 'Select an episode to view its tracklist';
    this._el.appendChild(div);
  }

  _renderDetail(ep) {
    const header = document.createElement('div');
    header.className = 'detail-header';

    const art = document.createElement('div');
    art.className = 'detail-art';
    if (ep.thumbnailUrl) {
      const img = document.createElement('img');
      img.src = ep.thumbnailUrl;
      img.alt = `MRR Radio #${ep.id}`;
      img.onerror = () => { img.remove(); art.appendChild(this._buildPlaceholder(ep.id)); };
      art.appendChild(img);
    } else {
      art.appendChild(this._buildPlaceholder(ep.id));
    }
    header.appendChild(art);

    const info = document.createElement('div');
    info.className = 'detail-info';

    const title = document.createElement('div');
    title.className = 'detail-title';
    title.textContent = `MRR RADIO #${ep.id}`;
    info.appendChild(title);

    if (ep.host) {
      const host = document.createElement('div');
      host.className = 'detail-host';
      host.textContent = ep.host;
      info.appendChild(host);
    }

    if (ep.date) {
      const date = document.createElement('div');
      date.className = 'detail-date';
      try {
        const d = new Date(ep.date + 'T12:00:00Z');
        date.textContent = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      } catch {
        date.textContent = ep.date;
      }
      info.appendChild(date);
    }

    header.appendChild(info);
    this._el.appendChild(header);

    if (ep.caption) {
      const caption = document.createElement('div');
      caption.className = 'detail-caption';
      caption.textContent = ep.caption;
      this._el.appendChild(caption);
    }

    const playBtn = document.createElement('button');
    playBtn.className = 'detail-play-btn';
    playBtn.textContent = 'Play Episode';
    playBtn.addEventListener('click', () => this._onPlay(ep.id));
    this._el.appendChild(playBtn);
  }

  async _renderTracklist(episodeId) {
    const tracks = await getTracks(episodeId);
    if (tracks.length === 0) return;

    const section = document.createElement('div');
    section.className = 'detail-tracklist';

    const hdr = document.createElement('div');
    hdr.className = 'tracklist-header';
    hdr.textContent = 'TRACKLIST';
    section.appendChild(hdr);

    let lastSection = null;
    for (const track of tracks) {
      if (track.section && track.section !== lastSection) {
        lastSection = track.section;
        const sh = document.createElement('div');
        sh.className = 'track-section-header';
        sh.textContent = track.section;
        section.appendChild(sh);
      }

      const item = document.createElement('div');
      item.className = 'track-item';

      if (track.startTime !== undefined && track.startTime !== null) {
        const ts = document.createElement('span');
        ts.className = 'track-timestamp';
        ts.textContent = fmtTime(track.startTime);
        item.appendChild(ts);
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

      const sep = document.createTextNode(' \u2013 ');
      const titleEl = document.createElement('span');
      titleEl.className = 'track-title';
      titleEl.textContent = track.title;

      item.appendChild(artistEl);
      item.appendChild(sep);
      item.appendChild(titleEl);
      section.appendChild(item);
    }

    this._el.appendChild(section);
  }

  _buildPlaceholder(id) {
    const div = document.createElement('div');
    div.className = 'detail-art-placeholder';
    const strong = document.createElement('strong');
    strong.textContent = `#${id}`;
    div.appendChild(strong);
    return div;
  }
}
