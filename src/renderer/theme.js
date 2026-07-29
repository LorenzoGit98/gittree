const Theme = {
  storageKey: 'gittree.theme',
  toneStorageKey: 'gittree.tones',
  themes: ['light', 'dark'],
  defaultTones: { light: 'frost', dark: 'onyx' },
  tones: {
    light: [
      { id: 'frost', preview: ['rgb(243,246,251)', 'rgb(255,255,255)', 'rgb(233,238,245)'] },
      { id: 'pure', preview: ['rgb(244,244,245)', 'rgb(255,255,255)', 'rgb(234,234,236)'] },
      { id: 'sand', preview: ['rgb(248,244,236)', 'rgb(255,253,249)', 'rgb(237,230,217)'] },
      { id: 'sage', preview: ['rgb(242,246,240)', 'rgb(252,254,249)', 'rgb(230,236,225)'] },
      { id: 'lilac', preview: ['rgb(244,241,250)', 'rgb(253,252,255)', 'rgb(233,228,241)'] }
    ],
    dark: [
      { id: 'onyx', preview: ['rgb(0,0,0)', 'rgb(0,0,0)', 'rgb(18,18,18)'] },
      { id: 'charcoal', preview: ['rgb(22,22,24)', 'rgb(28,28,31)', 'rgb(43,43,47)'] },
      { id: 'graphite', preview: ['rgb(16,20,26)', 'rgb(23,28,35)', 'rgb(38,46,56)'] },
      { id: 'umber', preview: ['rgb(21,17,16)', 'rgb(28,23,20)', 'rgb(44,37,32)'] },
      { id: 'pine', preview: ['rgb(13,18,14)', 'rgb(19,24,20)', 'rgb(33,42,35)'] }
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
