const Theme = {
  storageKey: 'gittree.theme',
  themes: ['light', 'dark', 'black'],

  init() {
    this.apply(localStorage.getItem(this.storageKey) || 'light', false);
  },

  toggle() {
    const current = document.documentElement.dataset.theme;
    const currentIndex = this.themes.indexOf(current);
    const next = this.themes[(currentIndex + 1) % this.themes.length];
    this.apply(next, true);
  },

  apply(theme, persist = true) {
    const safeTheme = this.themes.includes(theme) ? theme : 'light';
    document.documentElement.dataset.theme = safeTheme;
    if (persist) localStorage.setItem(this.storageKey, safeTheme);
    window.gitTree?.setTheme?.(safeTheme);
    this.syncControls();
  },

  syncControls() {
    const theme = document.documentElement.dataset.theme;
    const control = {
      light: { icon: 'ph ph-moon', titleKey: 'common.nextDarkTheme' },
      dark: { icon: 'ph ph-circle-half-tilt', titleKey: 'common.nextBlackTheme' },
      black: { icon: 'ph ph-sun', titleKey: 'common.nextLightTheme' }
    }[theme] || { icon: 'ph ph-moon', titleKey: 'common.nextDarkTheme' };

    document.querySelectorAll('.theme-toggle i').forEach(icon => {
      icon.className = control.icon;
    });
    if (window.i18next?.isInitialized) {
      document.querySelectorAll('.theme-toggle').forEach(button => {
        const label = t(control.titleKey);
        button.title = label;
        button.setAttribute('aria-label', label);
      });
    }
  }
};

Theme.init();
window.Theme = Theme;
