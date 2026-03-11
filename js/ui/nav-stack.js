/**
 * nav-stack.js — Mobile navigation stack
 *
 * Manages a stack of screen states for mobile single-column navigation.
 * Desktop doesn't use this — the left panel replaces content in-place.
 */

export class NavStack {
  /**
   * @param {function} onChange — (currentEntry, stackDepth) => void
   */
  constructor(onChange) {
    this._stack = [{ type: 'episode-list' }];
    this._onChange = onChange;
  }

  get current() {
    return this._stack[this._stack.length - 1];
  }

  get depth() {
    return this._stack.length;
  }

  push(entry) {
    this._stack.push(entry);
    this._emit();
  }

  back() {
    if (this._stack.length <= 1) return;
    this._stack.pop();
    this._emit();
  }

  home() {
    if (this._stack.length <= 1) return;
    this._stack = [this._stack[0]];
    this._emit();
  }

  _emit() {
    this._onChange(this.current, this.depth);
  }
}
