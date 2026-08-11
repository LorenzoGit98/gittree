/* exported ShortcutController */
class ShortcutController {
  constructor({ document, platform, translate, callbacks }) {
    this.document = document;
    this.platform = platform;
    this.translate = translate;
    this.callbacks = callbacks;
    this.keydownListener = null;
  }

  definitions() {
    return {
      open: { key: 'o' },
      search: { key: 'p' },
      fetch: { key: 'f', shift: true },
      pull: { key: 'l', shift: true },
      push: { key: 'p', shift: true },
      newBranch: { key: 'b', shift: true }
    };
  }

  label(action) {
    const shortcut = this.definitions()[action];
    if (!shortcut) return '';
    if (shortcut.primary === false) return shortcut.key;
    if (this.platform === 'darwin') {
      return `⌘${shortcut.shift ? '⇧' : ''}${shortcut.key.toUpperCase()}`;
    }
    return `Ctrl+${shortcut.shift ? 'Shift+' : ''}${shortcut.key.toUpperCase()}`;
  }

  isPrimaryModifier(event) {
    return this.platform === 'darwin' ? event.metaKey : event.ctrlKey;
  }

  setPlatform(platform) {
    this.platform = platform || 'win32';
  }

  refreshHints() {
    this.document.querySelectorAll('[data-platform-shortcut]').forEach(element => {
      element.textContent = this.label(element.dataset.platformShortcut);
    });
    const titleKeys = {
      fetch: 'actions.fetch',
      pull: 'actions.pull',
      push: 'actions.push',
      newBranch: 'sidebar.newBranch'
    };
    this.document.querySelectorAll('[data-shortcut-title]').forEach(element => {
      const action = element.dataset.shortcutTitle;
      element.title = `${this.translate(titleKeys[action])} (${this.label(action)})`;
      element.setAttribute('aria-label', element.title);
    });
  }

  mount() {
    if (this.keydownListener) return;
    this.keydownListener = event => this.handleKeydown(event);
    this.document.addEventListener('keydown', this.keydownListener);
  }

  handleKeydown(event) {
    const editable = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
    const modalOpen = !this.document
      .getElementById('modal-overlay')
      .classList.contains('is-hidden');
    const primary = this.isPrimaryModifier(event);
    const key = event.key.toLowerCase();

    if (!event.repeat && !editable && !modalOpen && primary && !event.shiftKey && key === 'o') {
      event.preventDefault();
      this.callbacks.openRepository();
    }
    if (!event.repeat && !editable && !modalOpen && primary && event.shiftKey) {
      const action = {
        f: 'fetch',
        l: 'pull',
        p: 'push',
        b: 'newBranch'
      }[key];
      if (action) {
        event.preventDefault();
        this.callbacks[action]();
      }
    }
    if (
      event.key === 'Escape' &&
      !modalOpen &&
      this.callbacks.getInspectorState() === 'maximized'
    ) {
      this.callbacks.restoreInspector();
    }
  }

  destroy() {
    if (!this.keydownListener) return;
    this.document.removeEventListener('keydown', this.keydownListener);
    this.keydownListener = null;
  }
}

if (typeof module !== 'undefined') module.exports = ShortcutController;
