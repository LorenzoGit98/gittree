const Theme = {
  storageKey: 'gittree.theme',

  init() {
    this.apply(localStorage.getItem(this.storageKey) || 'light', false);
  },

  toggle() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    this.apply(next, true);
  },

  apply(theme, persist = true) {
    const safeTheme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = safeTheme;
    if (persist) localStorage.setItem(this.storageKey, safeTheme);
    window.gitTree?.setTheme?.(safeTheme);
    document.querySelectorAll('.theme-toggle i').forEach(icon => {
      icon.className = safeTheme === 'dark' ? 'ph ph-sun' : 'ph ph-moon';
    });
  }
};

Theme.init();
window.Theme = Theme;
