const I18n = {
  supportedLanguages: ['en', 'it'],

  async init() {
    const stored = localStorage.getItem('gittree.language');
    const systemLanguage = navigator.language?.toLowerCase().startsWith('it') ? 'it' : 'en';
    const language = this.supportedLanguages.includes(stored) ? stored : systemLanguage;

    await i18next.init({
      lng: language,
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
      resources: {
        en: {
          translation: {
            common: {
              toggleTheme: 'Toggle theme',
              changeLanguage: 'Change language',
              close: 'Close',
              cancel: 'Cancel',
              loading: 'Loading…',
              error: 'Error'
            },
            welcome: {
              eyebrow: 'Git workspace',
              subtitle: 'A focused desktop client for branches, commits and code review.',
              open: 'Open repository',
              clone: 'Clone repository',
              recent: 'Recent repositories'
            },
            tabs: { add: 'Add repository' },
            sidebar: {
              workspace: 'Workspace',
              branches: 'Branches',
              newBranch: 'New branch',
              filter: 'Filter branches',
              createBranch: 'Create branch',
              stashes: 'Stashes',
              tags: 'Tags',
              local: 'Local',
              remote: 'Remote',
              noBranches: 'No branches',
              noMatch: 'No branches match'
            },
            history: {
              eyebrow: 'Repository activity',
              title: 'Commit history',
              message: 'Message',
              author: 'Author',
              date: 'Date',
              hash: 'Hash',
              loading: 'Loading commits…',
              empty: 'No commits found'
            },
            search: {
              trigger: 'Search commits, branches and files',
              placeholder: 'Search branches, commits, files and tags',
              empty: 'No results found',
              branches: 'Branches',
              commits: 'Commits',
              files: 'Files'
            },
            details: {
              eyebrow: 'Inspector',
              title: 'Commit details',
              unified: 'Unified',
              split: 'Split',
              placeholder: 'Select a commit to inspect its changes.',
              loading: 'Loading diff…',
              noChanges: 'No changes'
            },
            actions: {
              fetch: 'Fetch',
              pull: 'Pull',
              push: 'Push',
              refresh: 'Refresh',
              previous: 'Previous',
              next: 'Next'
            },
            feedback: {
              notRepo: 'This folder is not a Git repository',
              cloneSoon: 'Clone support is coming soon',
              refreshed: 'Repository refreshed',
              fetching: 'Fetching…',
              fetchComplete: 'Fetch complete',
              pulling: 'Pulling…',
              pullComplete: 'Pull complete',
              pushing: 'Pushing…',
              pushComplete: 'Push complete'
            }
          }
        },
        it: {
          translation: {
            common: {
              toggleTheme: 'Cambia tema',
              changeLanguage: 'Cambia lingua',
              close: 'Chiudi',
              cancel: 'Annulla',
              loading: 'Caricamento…',
              error: 'Errore'
            },
            welcome: {
              eyebrow: 'Spazio di lavoro Git',
              subtitle: 'Un client desktop essenziale per branch, commit e revisione del codice.',
              open: 'Apri repository',
              clone: 'Clona repository',
              recent: 'Repository recenti'
            },
            tabs: { add: 'Aggiungi repository' },
            sidebar: {
              workspace: 'Workspace',
              branches: 'Branch',
              newBranch: 'Nuovo branch',
              filter: 'Filtra branch',
              createBranch: 'Crea branch',
              stashes: 'Stash',
              tags: 'Tag',
              local: 'Locali',
              remote: 'Remoti',
              noBranches: 'Nessun branch',
              noMatch: 'Nessun branch corrispondente'
            },
            history: {
              eyebrow: 'Attività repository',
              title: 'Cronologia commit',
              message: 'Messaggio',
              author: 'Autore',
              date: 'Data',
              hash: 'Hash',
              loading: 'Caricamento commit…',
              empty: 'Nessun commit'
            },
            search: {
              trigger: 'Cerca commit, branch e file',
              placeholder: 'Cerca branch, commit, file e tag',
              empty: 'Nessun risultato',
              branches: 'Branch',
              commits: 'Commit',
              files: 'File'
            },
            details: {
              eyebrow: 'Inspector',
              title: 'Dettagli commit',
              unified: 'Unificato',
              split: 'Affiancato',
              placeholder: 'Seleziona un commit per esaminare le modifiche.',
              loading: 'Caricamento diff…',
              noChanges: 'Nessuna modifica'
            },
            actions: {
              fetch: 'Fetch',
              pull: 'Pull',
              push: 'Push',
              refresh: 'Aggiorna',
              previous: 'Precedente',
              next: 'Successivo'
            },
            feedback: {
              notRepo: 'Questa cartella non è un repository Git',
              cloneSoon: 'La clonazione sarà disponibile presto',
              refreshed: 'Repository aggiornato',
              fetching: 'Fetch in corso…',
              fetchComplete: 'Fetch completato',
              pulling: 'Pull in corso…',
              pullComplete: 'Pull completato',
              pushing: 'Push in corso…',
              pushComplete: 'Push completato'
            }
          }
        }
      }
    });

    document.documentElement.lang = language;
    this.syncControls();
  },

  t(key, options) {
    return i18next.t(key, options);
  },

  async toggleLanguage() {
    const next = i18next.language === 'it' ? 'en' : 'it';
    await i18next.changeLanguage(next);
    localStorage.setItem('gittree.language', next);
    document.documentElement.lang = next;
    this.translateDOM();
    this.syncControls();
    window.dispatchEvent(new CustomEvent('gittree:language-changed', { detail: next }));
  },

  translateDOM(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(element => {
      element.textContent = this.t(element.dataset.i18n);
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
      element.placeholder = this.t(element.dataset.i18nPlaceholder);
    });
    root.querySelectorAll('[data-i18n-title]').forEach(element => {
      element.title = this.t(element.dataset.i18nTitle);
    });
  },

  syncControls() {
    const code = (i18next.language || 'en').slice(0, 2).toUpperCase();
    document.querySelectorAll('.language-code').forEach(element => {
      element.textContent = code;
    });
  }
};

window.I18n = I18n;
window.t = (key, options) => I18n.t(key, options);
