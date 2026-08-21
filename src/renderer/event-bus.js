/* exported EventBus */
/**
 * Minimal application event bus (ADR-0008, A3).
 *
 * Replaces direct reach-ins into the app composition root. Known channels:
 * - 'repo:changed'     -> payload: repository entry that became active
 * - 'repo:cleared'     -> no payload
 * - 'commit:selected'  -> payload: commit hash string
 * - 'refresh'          -> no payload
 *
 * Semantics match the previous app.on/app.emit pair: listeners registered
 * during an emit for the same channel are invoked in the same pass.
 */
class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  /**
   * @param {string} event
   * @param {(payload: unknown) => void} callback
   * @returns {() => void} unsubscribe function
   */
  on(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    const list = this.listeners.get(event);
    if (!list) return;
    const index = list.indexOf(callback);
    if (index !== -1) list.splice(index, 1);
  }

  emit(event, data) {
    const list = this.listeners.get(event);
    if (list) list.forEach(callback => callback(data));
  }

  listenerCount(event) {
    return this.listeners.get(event)?.length || 0;
  }

  clear() {
    this.listeners.clear();
  }
}

if (typeof module === 'object' && module.exports) module.exports = EventBus;
