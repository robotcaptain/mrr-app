/**
 * episode-list.js — Episode card renderer
 */

function fmtDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso + 'T12:00:00Z');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

function buildPlaceholder(id) {
  const inner = document.createElement('div');
  inner.className = 'ep-thumb-placeholder';
  const strong = document.createElement('strong');
  strong.textContent = `#${id}`;
  inner.appendChild(strong);
  return inner;
}

function buildThumb(ep) {
  const div = document.createElement('div');
  div.className = 'ep-thumb';

  if (ep.thumbnailUrl) {
    const img = document.createElement('img');
    img.src = ep.thumbnailUrl;
    img.alt = `MRR Radio #${ep.id}`;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.onerror = () => { img.remove(); div.appendChild(buildPlaceholder(ep.id)); };
    div.appendChild(img);
  } else {
    div.appendChild(buildPlaceholder(ep.id));
  }

  return div;
}

export function buildCard(ep, isPlayed, onClick, tracks) {
  const card = document.createElement('div');
  card.className = 'episode-card';
  card.dataset.id = ep.id;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `Episode ${ep.id}, ${ep.host}, ${fmtDate(ep.date)}`);

  card.appendChild(buildThumb(ep));

  const body = document.createElement('div');
  body.className = 'ep-body';

  // Meta row: episode number + date
  const meta = document.createElement('div');
  meta.className = 'ep-meta';
  const numEl = document.createElement('span');
  numEl.className = 'ep-num';
  numEl.textContent = `#${ep.id}`;
  const dateEl = document.createElement('span');
  dateEl.className = 'ep-date';
  dateEl.textContent = fmtDate(ep.date);
  meta.appendChild(numEl);
  meta.appendChild(dateEl);
  if (ep.indexed) {
    const badge = document.createElement('span');
    badge.className = 'ep-indexed-badge';
    badge.textContent = 'INDEXED';
    meta.appendChild(badge);
  }
  body.appendChild(meta);

  if (ep.host) {
    const host = document.createElement('div');
    host.className = 'ep-host';
    host.textContent = ep.host;
    body.appendChild(host);
  }

  if (ep.caption) {
    const caption = document.createElement('div');
    caption.className = 'ep-caption';
    caption.textContent = ep.caption;
    body.appendChild(caption);
  }

  if (tracks && tracks.length > 0) {
    const tracksEl = document.createElement('div');
    tracksEl.className = 'ep-artist-tracks';
    tracksEl.textContent = tracks.join(' · ');
    body.appendChild(tracksEl);
  }

  card.appendChild(body);

  if (isPlayed) {
    const dot = document.createElement('div');
    dot.className = 'ep-played-dot';
    dot.setAttribute('aria-label', 'Played');
    card.appendChild(dot);
  }

  const handle = (e) => {
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onClick(ep.id);
  };
  card.addEventListener('click', handle);
  card.addEventListener('keydown', handle);

  return card;
}

export function renderList(container, episodes, playedSet, onEpisodeClick, tracksByEpisode) {
  const frag = document.createDocumentFragment();
  for (const ep of episodes) {
    frag.appendChild(buildCard(ep, playedSet.has(ep.id), onEpisodeClick, tracksByEpisode?.get(ep.id)));
  }
  container.replaceChildren(frag);
}

export function markCardPlayed(container, episodeId) {
  const card = container.querySelector(`[data-id="${episodeId}"]`);
  if (!card || card.querySelector('.ep-played-dot')) return;
  const dot = document.createElement('div');
  dot.className = 'ep-played-dot';
  dot.setAttribute('aria-label', 'Played');
  card.appendChild(dot);
}

export function setActiveCard(container, episodeId) {
  container.querySelectorAll('.episode-card.active').forEach((el) => el.classList.remove('active'));
  const card = episodeId ? container.querySelector(`[data-id="${episodeId}"]`) : null;
  if (card) card.classList.add('active');
}
