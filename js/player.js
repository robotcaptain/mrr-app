/**
 * player.js — Audio playback engine
 *
 * Handles:
 *   - HTML5 Audio element lifecycle
 *   - Timestamp persistence (every 5s + on pause/unload)
 *   - Resume from saved position
 *   - Marking episodes as played (within 60s of end)
 *   - State change notifications to UI
 *
 * State listeners receive: { episodeId, isPlaying, currentTime, duration, progress }
 */

import { getPlayback, updatePlayback } from './db.js';

const SAVE_INTERVAL_MS = 5000;
const PLAYED_THRESHOLD_SECS = 60; // mark played when within this many seconds of end

export class Player {
  constructor() {
    this._audio = new Audio();
    this._audio.preload = 'none';

    this._episodeId = null;
    this._duration = 0;
    this._saveTimer = null;
    this._listeners = new Set();
    this._markedPlayed = false;

    this._bindAudioEvents();
    this._bindUnloadSave();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  get episodeId() { return this._episodeId; }
  get isPlaying() { return !this._audio.paused; }
  get currentTime() { return this._audio.currentTime; }
  get duration() { return this._audio.duration || this._duration; }

  /**
   * Load and play an episode.
   * Resumes from saved timestamp if available and not near the end.
   */
  async play(episode) {
    const isSameEpisode = this._episodeId === episode.id;

    if (!isSameEpisode) {
      this._stopSaveTimer();
      this._episodeId = episode.id;
      this._duration = episode.durationSecs || 0;
      this._markedPlayed = false;

      // Resolve audio source (local file or CDN)
      const src = episode.localAudio
        ? `/public/audio/mrr-radio-${episode.id}.mp3`
        : episode.mp3Url;

      this._audio.src = src;
      this._audio.load();

      // Restore timestamp
      const pb = await getPlayback(episode.id);
      const saved = pb?.timestamp || 0;
      const nearEnd = this._duration > 0 && saved >= this._duration - PLAYED_THRESHOLD_SECS;

      if (saved > 0 && !nearEnd) {
        // Seek after canplay fires
        this._seekOnLoad = saved;
      } else {
        this._seekOnLoad = 0;
      }
    }

    try {
      await this._audio.play();
    } catch (err) {
      if (err.name !== 'AbortError') console.warn('Playback error:', err);
    }
  }

  pause() {
    this._audio.pause();
  }

  toggle() {
    if (this._audio.paused) {
      this._audio.play().catch(() => {});
    } else {
      this._audio.pause();
    }
  }

  seek(secs) {
    if (!isFinite(secs)) return;
    this._audio.currentTime = Math.max(0, Math.min(secs, this._audio.duration || Infinity));
  }

  seekRelative(deltaSecs) {
    this.seek(this._audio.currentTime + deltaSecs);
  }

  // ── Listeners ──────────────────────────────────────────────────────────────

  /** Register a state change listener. Returns unsubscribe function. */
  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _notify() {
    const dur = this._audio.duration || this._duration || 0;
    const cur = this._audio.currentTime || 0;
    const state = {
      episodeId: this._episodeId,
      isPlaying: !this._audio.paused,
      currentTime: cur,
      duration: dur,
      progress: dur > 0 ? cur / dur : 0,
    };
    for (const fn of this._listeners) fn(state);
  }

  // ── Audio event wiring ─────────────────────────────────────────────────────

  _bindAudioEvents() {
    const audio = this._audio;

    audio.addEventListener('canplay', () => {
      if (this._seekOnLoad > 0) {
        audio.currentTime = this._seekOnLoad;
        this._seekOnLoad = 0;
      }
    });

    audio.addEventListener('play', () => {
      this._startSaveTimer();
      this._notify();
    });

    audio.addEventListener('pause', () => {
      this._stopSaveTimer();
      this._saveTimestamp();
      this._notify();
    });

    audio.addEventListener('timeupdate', () => {
      this._notify();
      this._checkPlayed();
    });

    audio.addEventListener('ended', () => {
      this._stopSaveTimer();
      this._markPlayed();
      this._notify();
    });

    audio.addEventListener('durationchange', () => {
      if (audio.duration && isFinite(audio.duration)) {
        this._duration = audio.duration;
      }
      this._notify();
    });

    audio.addEventListener('error', () => {
      console.warn('Audio error:', audio.error);
      this._notify();
    });
  }

  _bindUnloadSave() {
    const save = () => this._saveTimestamp();
    window.addEventListener('pagehide', save);
    window.addEventListener('beforeunload', save);
    // On iOS, pagehide is more reliable than beforeunload
  }

  // ── Timestamp persistence ──────────────────────────────────────────────────

  _startSaveTimer() {
    this._stopSaveTimer();
    this._saveTimer = setInterval(() => this._saveTimestamp(), SAVE_INTERVAL_MS);
  }

  _stopSaveTimer() {
    if (this._saveTimer) {
      clearInterval(this._saveTimer);
      this._saveTimer = null;
    }
  }

  async _saveTimestamp() {
    if (!this._episodeId) return;
    const t = Math.floor(this._audio.currentTime || 0);
    if (t <= 0) return;
    await updatePlayback(this._episodeId, {
      timestamp: t,
      lastPlayed: new Date().toISOString(),
    });
  }

  // ── Played marking ─────────────────────────────────────────────────────────

  _checkPlayed() {
    if (this._markedPlayed) return;
    const dur = this._audio.duration;
    if (!dur || !isFinite(dur)) return;
    if (this._audio.currentTime >= dur - PLAYED_THRESHOLD_SECS) {
      this._markPlayed();
    }
  }

  async _markPlayed() {
    if (this._markedPlayed || !this._episodeId) return;
    this._markedPlayed = true;
    await updatePlayback(this._episodeId, {
      played: true,
      timestamp: 0,  // reset so next play starts from beginning
      lastPlayed: new Date().toISOString(),
    });
    // Notify listeners so UI can update played indicator
    this._notify();
  }
}
