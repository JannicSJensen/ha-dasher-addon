/**
 * Selector-based reactive store (ported from the original dasher SPA).
 * Subscribers only fire when their selector returns a new reference.
 */
export class Store {
  constructor(initial) {
    this.state = initial;
    this._subs = new Set();
  }

  getState() {
    return this.state;
  }

  setState(patch) {
    const next = typeof patch === "function" ? patch(this.state) : { ...this.state, ...patch };
    if (next === this.state) return;
    this.state = next;
    for (const sub of [...this._subs]) sub(next);
  }

  subscribe(selector, handler) {
    let last = selector(this.state);
    const sub = (state) => {
      const next = selector(state);
      if (next !== last) {
        last = next;
        handler(next);
      }
    };
    this._subs.add(sub);
    return () => this._subs.delete(sub);
  }
}
