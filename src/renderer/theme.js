const Theme = {
  storageKey: 'gittree.theme',
  toneStorageKey: 'gittree.tones',
  themes: ['light', 'dark'],
  defaultTones: { light: 'frost', dark: 'onyx' },
  tones: {
    light: [
      { id: 'frost', preview: ['#f3f6fb', '#ffffff', '#e9eef5'] },
      { id: 'pure', preview: ['#f4f4f5', '#ffffff', '#eaeaec'] },
      { id: 'sand', preview: ['#f8f4ec', '#fffdf9', '#ede6d9'] },
      { id: 'sage', preview: ['#f2f6f0', '#fcfef9', '#e6ece1'] },
      { id: 'lilac', preview: ['#f4f1fa', '#fdfcff', '#e9e4f1'] }
    ],
    dark: [
      { id: 'onyx', preview: ['#000000', '#000000', '#121212'] },
      { id: 'charcoal', preview: ['#161618', '#1c1c1f', '#2b2b2f'] },
      { id: 'graphite', preview: ['#10141a', '#171c23', '#262e38'] },
      { id: 'umber', preview: ['#151110', '#1c1714', '#2c2520'] },
      { id: 'pine', preview: ['#0d120e', '#131814', '#212a23'] }
    ]
  },

  init() {
    let saved = localStorage.getItem(this.storageKey) || 'light';
    if (saved === 'black') saved = 'dark';
    this.apply(saved, false);
  },

  toggle() {
    const current = document.documentElement.dataset.theme;
    this.apply(current === 'light' ? 'dark' : 'light', true);
  },

  apply(theme, persist = true) {
    const safeTheme = this.themes.includes(theme) ? theme : 'light';
    document.documentElement.dataset.theme = safeTheme;
    document.documentElement.dataset.tone = this.getTone(safeTheme);
    if (persist) localStorage.setItem(this.storageKey, safeTheme);
    this.notifyMain(safeTheme);
    this.syncControls();
  },

  setTone(theme, toneId) {
    const safeTheme = this.themes.includes(theme) ? theme : 'light';
    if (!this.tones[safeTheme].some(tone => tone.id === toneId)) return;
    const tones = this.readTones();
    tones[safeTheme] = toneId;
    localStorage.setItem(this.toneStorageKey, JSON.stringify(tones));
    if (document.documentElement.dataset.theme === safeTheme) {
      document.documentElement.dataset.tone = toneId;
      this.notifyMain(safeTheme);
    }
  },

  getTone(theme) {
    const toneId = this.readTones()[theme] || this.defaultTones[theme];
    const valid = this.tones[theme]?.some(tone => tone.id === toneId);
    return valid ? toneId : this.defaultTones[theme];
  },

  readTones() {
    try {
      const value = JSON.parse(localStorage.getItem(this.toneStorageKey));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  },

  notifyMain(theme) {
    const shell = getComputedStyle(document.documentElement)
      .getPropertyValue('--surface-shell').trim();
    window.gitTree?.setTheme?.(theme, shell);
  },

  syncControls() {
    const theme = document.documentElement.dataset.theme;
    const control = theme === 'light'
      ? { icon: 'ph ph-moon', titleKey: 'common.nextDarkTheme' }
      : { icon: 'ph ph-sun', titleKey: 'common.nextLightTheme' };

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
