/**
 * filters.js — Host/year dropdowns + search input
 *
 * Manages three independent filter states:
 *   - search query (debounced, matches artist OR song title)
 *   - host filter (exact match)
 *   - year filter (matches ISO date prefix)
 *
 * When any filter changes, calls onFilterChange(filterState).
 * The caller resolves the combined episode list and re-renders.
 */

import { getHosts, getYears } from '../db.js';

const DEBOUNCE_MS = 300;

export class Filters {
  constructor({ searchEl, clearEl, hostEl, yearEl, onFilterChange }) {
    this._searchEl = searchEl;
    this._clearEl = clearEl;
    this._hostEl = hostEl;
    this._yearEl = yearEl;
    this._onChange = onFilterChange;

    this._state = { query: '', host: '', year: '' };
    this._debounceTimer = null;

    this._bindEvents();
  }

  get state() {
    return { ...this._state };
  }

  // ── Populate dropdowns ─────────────────────────────────────────────────────

  async populate() {
    const [hosts, years] = await Promise.all([getHosts(), getYears()]);

    for (const host of hosts) {
      const opt = document.createElement('option');
      opt.value = host;
      opt.textContent = host;
      this._hostEl.appendChild(opt);
    }

    for (const year of years) {
      const opt = document.createElement('option');
      opt.value = year;
      opt.textContent = year;
      this._yearEl.appendChild(opt);
    }
  }

  // ── Event binding ──────────────────────────────────────────────────────────

  _bindEvents() {
    // Search input — debounced
    this._searchEl.addEventListener('input', () => {
      const q = this._searchEl.value.trim();
      this._clearEl.hidden = q.length === 0;
      clearTimeout(this._debounceTimer);
      this._debounceTimer = setTimeout(() => {
        this._state.query = q;
        this._emit();
      }, DEBOUNCE_MS);
    });

    // Clear button
    this._clearEl.addEventListener('click', () => {
      this._searchEl.value = '';
      this._clearEl.hidden = true;
      this._state.query = '';
      this._emit();
      this._searchEl.focus();
    });

    // Host dropdown
    this._hostEl.addEventListener('change', () => {
      this._state.host = this._hostEl.value;
      this._emit();
    });

    // Year dropdown
    this._yearEl.addEventListener('change', () => {
      this._state.year = this._yearEl.value;
      this._emit();
    });
  }

  _emit() {
    this._onChange(this.state);
  }

  /** Programmatically reset all filters */
  reset() {
    this._searchEl.value = '';
    this._clearEl.hidden = true;
    this._hostEl.value = '';
    this._yearEl.value = '';
    this._state = { query: '', host: '', year: '' };
    this._emit();
  }
}
