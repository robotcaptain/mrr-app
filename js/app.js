/**
 * app.js — MRR Radio bootstrap
 *
 * Initialises all modules, wires state, handles episode playback flow.
 */

import { init as initData, sync, checkForUpdate } from './data-loader.js';
import { getEpisodes, getEpisode, getPlayback, searchTracks } from './db.js';
import { Player } from './player.js';
import { Filters } from './ui/filters.js';
import { renderList, setActiveCard, markCardPlayed } from './ui/episode-list.js';
import { PlayerUI } from './ui/player-ui.js';
import { ArtistView } from './ui/artist-view.js';
import { ArtistIndex } from './ui/artist-index.js';
import { EpisodeDetail } from './ui/episode-detail.js';
import { NavStack } from './ui/nav-stack.js';

// ── State ──────────────────────────────────────────────────────────────────────
const state = {
  episodes: [],         // current filtered list
  allEpisodes: [],      // unfiltered full list
  playedSet: new Set(), // episode IDs the user has played to completion
  filters: { query: '', host: '', year: '' },
  currentEpisodeId: null,
  selectedEpisodeId: null,
};

// ── DOM refs ───────────────────────────────────────────────────────────────────
const loadingView   = document.getElementById('loading-view');
const loadingMsg    = document.getElementById('loading-msg');
const emptyView     = document.getElementById('empty-view');
const episodeList   = document.getElementById('episode-list');
const syncBtn       = document.getElementById('sync-btn');
const lastUpdatedEl = document.getElementById('last-updated');

const searchInput     = document.getElementById('search-input');
const searchCancel    = document.getElementById('search-cancel');
const searchClear     = document.getElementById('search-clear');
const artistIndexEl   = document.getElementById('artist-index-overlay');
const artistIndexList = document.getElementById('artist-index-list');

const leftColumn    = document.getElementById('left-column');
const rightColumn   = document.getElementById('right-column');
const detailEl      = document.getElementById('episode-detail');
const navBackBtn    = document.getElementById('nav-back-btn');
const navHomeBtn    = document.getElementById('nav-home-btn');
const navButtonsEl  = document.getElementById('nav-buttons');
const navTitleEl    = document.getElementById('nav-title');
const appTitle      = document.querySelector('.app-title');

function updateLastUpdatedDisplay() {
  const raw = localStorage.getItem('mrr-last-updated');
  if (!raw || !lastUpdatedEl) return;
  const d = new Date(raw);
  const fmt = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  lastUpdatedEl.textContent = `Updated ${fmt}`;
}

function markUpdatedNow() {
  localStorage.setItem('mrr-last-updated', new Date().toISOString());
  updateLastUpdatedDisplay();
}

// ── Modules ────────────────────────────────────────────────────────────────────
const player = new Player();
const playerUI = new PlayerUI(player, handleArtistClick);
const artistView = new ArtistView(handleEpisodeClick, state.playedSet, () => {
  if (isMobile()) navStack.back();
});

const episodeDetail = new EpisodeDetail(detailEl, {
  onPlay: handlePlayClick,
  onArtistClick: handleArtistClick,
});
episodeDetail.clear();

const isMobile = () => window.innerWidth < 768;

const navStack = new NavStack((entry, depth) => {
  if (!isMobile()) return;

  if (depth <= 1) {
    // Root — show app title, hide nav buttons
    navButtonsEl.hidden = true;
    navTitleEl.hidden = true;
    appTitle.hidden = false;
    document.body.classList.remove('mobile-detail');
  } else {
    // Deeper — show back, maybe home
    navButtonsEl.hidden = false;
    navBackBtn.hidden = false;
    navHomeBtn.hidden = depth <= 2;
    appTitle.hidden = true;
    navTitleEl.hidden = false;
    navTitleEl.textContent = entry.title || '';

    if (entry.type === 'episode-detail') {
      document.body.classList.add('mobile-detail');
    } else {
      document.body.classList.remove('mobile-detail');
    }
  }
});

navBackBtn.addEventListener('click', () => {
  const prev = navStack.current;
  navStack.back();
  // If we backed out of episode detail, deselect
  if (prev.type === 'episode-detail' && navStack.current.type !== 'episode-detail') {
    document.body.classList.remove('mobile-detail');
  }
});
navHomeBtn.addEventListener('click', () => {
  navStack.home();
  document.body.classList.remove('mobile-detail');
});

const artistIndex = new ArtistIndex({
  overlayEl: artistIndexEl,
  listEl: artistIndexList,
  onArtistSelect: (name) => {
    closeArtistIndex();
    handleArtistClick(name);
  },
});

const filters = new Filters({
  searchEl: document.getElementById('search-input'),
  clearEl:  document.getElementById('search-clear'),
  hostEl:   document.getElementById('host-filter'),
  yearEl:   document.getElementById('year-filter'),
  onFilterChange: handleFilterChange,
});

function openArtistIndex() {
  if (artistIndex.isOpen) return;
  searchCancel.hidden = false;
  searchClear.hidden = true;
  artistIndex.open();
}

function closeArtistIndex() {
  searchCancel.hidden = true;
  searchInput.value = '';
  artistIndex.close();
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  searchInput.blur();
}

searchInput.addEventListener('focus', () => openArtistIndex());
searchCancel.addEventListener('click', () => closeArtistIndex());
searchInput.addEventListener('input', () => {
  if (artistIndex.isOpen) artistIndex.filter(searchInput.value.trim());
});

// Hide mini player when soft keyboard is visible
if ('visualViewport' in window) {
  window.visualViewport.addEventListener('resize', () => {
    const keyboardUp = window.visualViewport.height < window.innerHeight - 150;
    document.body.classList.toggle('keyboard-open', keyboardUp);
  });
}

// ── Bootstrap ──────────────────────────────────────────────────────────────────
async function boot() {
  // Register service worker
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js');
    } catch (err) {
      console.warn('SW registration failed:', err);
    }
  }

  // Load data
  try {
    await initData((msg) => { loadingMsg.textContent = msg; });
  } catch (err) {
    loadingMsg.textContent = `Error: ${err.message}`;
    return;
  }

  // Initial render
  state.allEpisodes = await getEpisodes();
  await loadPlayedSet();
  await filters.populate();

  state.episodes = state.allEpisodes;
  renderEpisodes(state.episodes);
  showMain();

  // Show last updated timestamp; set it now if first run
  if (!localStorage.getItem('mrr-last-updated')) markUpdatedNow();
  else updateLastUpdatedDisplay();

  // Check for newer data (fetches ~60 byte version file)
  checkForUpdate().then((hasUpdate) => {
    if (hasUpdate) syncBtn.classList.add('has-update');
  }).catch(() => {});
}

function showMain() {
  loadingView.hidden = true;
  if (state.episodes.length === 0) {
    emptyView.hidden = false;
    episodeList.hidden = true;
  } else {
    emptyView.hidden = true;
    episodeList.hidden = false;
  }
}

// ── Played set ─────────────────────────────────────────────────────────────────
async function loadPlayedSet() {
  // Batch-load playback records for all episodes in allEpisodes
  // We do this by checking each — a full getAll on playback store would be ideal
  // but the API doesn't expose that directly; load lazily as needed
  state.playedSet.clear();
  for (const ep of state.allEpisodes) {
    const pb = await getPlayback(ep.id);
    if (pb?.played) state.playedSet.add(ep.id);
  }
}

// ── Episode rendering ──────────────────────────────────────────────────────────
function renderEpisodes(episodes) {
  state.episodes = episodes;
  renderList(episodeList, episodes, state.playedSet, handleEpisodeClick);
  if (state.currentEpisodeId) {
    setActiveCard(episodeList, state.currentEpisodeId);
  }
}

// ── Filter handling ────────────────────────────────────────────────────────────
async function handleFilterChange(filterState) {
  state.filters = filterState;
  const { query, host, year } = filterState;

  let episodeIds;
  if (query) {
    episodeIds = await searchTracks(query);
    if (episodeIds.length === 0) {
      renderEpisodes([]);
      showMain();
      return;
    }
  }

  const filtered = await getEpisodes({
    host: host || undefined,
    year: year || undefined,
    episodeIds: episodeIds || undefined,
  });

  renderEpisodes(filtered);
  showMain();
}

// ── Episode click → browse (show detail) ────────────────────────────────────────
async function handleEpisodeClick(episodeId) {
  const episode = state.allEpisodes.find((e) => e.id === episodeId)
    || await getEpisode(episodeId);
  if (!episode) return;

  state.selectedEpisodeId = episodeId;
  setActiveCard(episodeList, episodeId);
  await episodeDetail.show(episode);

  // On mobile, push to nav stack
  if (isMobile()) {
    navStack.push({ type: 'episode-detail', episodeId, title: `#${episodeId}` });
  }
}

// ── Play click → start playback ─────────────────────────────────────────────────
async function handlePlayClick(episodeId) {
  const episode = state.allEpisodes.find((e) => e.id === episodeId)
    || await getEpisode(episodeId);
  if (!episode) return;

  state.currentEpisodeId = episodeId;
  playerUI.setEpisode(episode);
  await player.play(episode);
}

// ── Artist click ───────────────────────────────────────────────────────────────
function handleArtistClick(artistName) {
  playerUI.closeSheet();
  artistView.open(artistName);

  if (isMobile()) {
    navStack.push({ type: 'artist-view', artist: artistName, title: artistName });
  }
}

// ── Played state propagation ───────────────────────────────────────────────────
player.subscribe((playerState) => {
  if (!playerState.episodeId) return;

  // Check if episode just got marked played
  // We detect by checking DB — player fires notify after _markPlayed runs
  const id = playerState.episodeId;
  if (!state.playedSet.has(id) && !playerState.isPlaying && playerState.duration > 0) {
    // Re-check DB in case it was just marked played
    getPlayback(id).then((pb) => {
      if (pb?.played) {
        state.playedSet.add(id);
        markCardPlayed(episodeList, id);
      }
    });
  }
});

// ── Sync button ────────────────────────────────────────────────────────────────
syncBtn.addEventListener('click', async () => {
  syncBtn.classList.add('spinning');
  if (lastUpdatedEl) lastUpdatedEl.textContent = 'Syncing…';
  try {
    const result = await sync((msg) => console.log('sync:', msg));
    syncBtn.classList.remove('has-update');
    markUpdatedNow();
    if (result.added > 0) {
      state.allEpisodes = await getEpisodes();
      await handleFilterChange(state.filters);
      await filters.populate();
    }
  } catch (err) {
    console.warn('Sync failed:', err);
    updateLastUpdatedDisplay(); // restore previous text on error
  } finally {
    syncBtn.classList.remove('spinning');
  }
});

// ── Start ──────────────────────────────────────────────────────────────────────
boot().catch((err) => {
  console.error('Boot failed:', err);
  if (loadingMsg) loadingMsg.textContent = `Failed to start: ${err.message}`;
});
