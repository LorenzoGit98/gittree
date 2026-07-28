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
              minimize: 'Minimize',
              maximize: 'Maximize',
              nextLightTheme: 'Switch to light theme',
              nextDarkTheme: 'Switch to dark theme',
              nextBlackTheme: 'Switch to black theme',
              cancel: 'Cancel',
              continue: 'Continue',
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
              empty: 'No commits found',
              daysAgo_one: '{{count}}d ago',
              daysAgo_other: '{{count}}d ago'
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
              changesIn: 'Changes in {{hash}}',
              unified: 'Unified',
              split: 'Split',
              diffLayout: 'Diff layout',
              maximize: 'Maximize inspector',
              restore: 'Restore inspector',
              close: 'Close inspector',
              placeholder: 'Select a commit to inspect its changes.',
              loading: 'Loading diff…',
              noChanges: 'No changes'
            },
            actions: {
              fetch: 'Fetch',
              pull: 'Pull',
              push: 'Push',
              refresh: 'Refresh',
              repositoryActions: 'Repository actions',
              previous: 'Previous',
              next: 'Next'
            },
            branchMenu: {
              checkout: 'Checkout {{branch}}…',
              alreadyCurrent: 'This is already the current branch',
              mergeIntoCurrent: 'Merge {{branch}} into current branch',
              rebaseOnto: 'Rebase current branch onto {{branch}}',
              sameBranch: 'Select a branch different from the current branch',
              cleanRequired: 'Commit or stash the working tree changes first',
              pendingOperation: 'Finish or abort the pending {{operation}} first',
              fetch: 'Fetch {{branch}}',
              pullTracked: 'Pull tracked branch',
              currentOnly: 'Available only for the current branch',
              noUpstream: 'No upstream branch is configured',
              pushTracked: 'Push tracked',
              pushTo: 'Push to…',
              trackRemote: 'Track remote branch',
              noRemotes: 'No remotes configured',
              noRemoteBranches: 'No remote branches available',
              stashChanges: 'Stash blocking changes…',
              diffAgainstCurrent: 'Diff Against Current',
              rename: 'Rename {{branch}}…',
              renameUnavailable: 'Rename unavailable',
              localOnly: 'Available only for local branches',
              delete: 'Delete {{branch}}…',
              deleteCurrent: 'The current branch cannot be deleted',
              createPullRequest: 'Create pull request…',
              unsupportedProvider: 'Supported for GitHub, GitLab and Bitbucket remotes',
              operationComplete: 'Branch operation completed',
              renameTitle: 'Rename branch',
              branchNameLabel: 'Branch name',
              deleteTitle: 'Delete branch',
              deleteConfirm: 'Delete {{branch}} safely?',
              deleteAction: 'Delete',
              forceDeleteTitle: 'Force delete branch',
              forceDeleteConfirm: '{{branch}} is not fully merged. Force delete it?',
              forceDeleteAction: 'Force delete',
              prTitle: 'Create pull request',
              remoteLabel: 'Remote',
              targetLabel: 'Target branch'
            },
            conflicts: {
              operation: '{{operation}} in progress',
              title: 'Resolve conflicts',
              remaining: 'remaining',
              files: 'Conflicted files',
              abort: 'Abort',
              allResolved: 'All conflicts resolved',
              readyContinue: 'The operation is ready to continue.',
              binary: 'Binary',
              acceptOurs: 'Accept ours',
              acceptTheirs: 'Accept theirs',
              saveResult: 'Save result',
              binaryTitle: 'Binary conflict',
              binaryHelp: 'Choose the current or incoming version. Text editing is unavailable.',
              base: 'Common base',
              ours: 'Current branch',
              theirs: 'Incoming branch',
              result: 'Result',
              completed: 'Git operation completed',
              abortTitle: 'Abort operation',
              abortConfirm: 'Discard the pending operation and restore its previous state?',
              discardTitle: 'Discard unsaved result',
              discardConfirm: 'The manual result has unsaved changes. Discard them?'
            },
            updates: {
              available: 'Update available',
              availableVersion: 'GitTree {{version}} available',
              downloading: 'Downloading {{progress}}%',
              restart: 'Restart to update',
              ready: 'The update is ready. Restart GitTree to install it.',
              failed: 'Update failed: {{error}}'
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
              minimize: 'Riduci a icona',
              maximize: 'Ingrandisci',
              nextLightTheme: 'Passa al tema chiaro',
              nextDarkTheme: 'Passa al tema scuro',
              nextBlackTheme: 'Passa al tema nero',
              cancel: 'Annulla',
              continue: 'Continua',
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
              empty: 'Nessun commit',
              daysAgo_one: '{{count}} g fa',
              daysAgo_other: '{{count}} g fa'
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
              changesIn: 'Modifiche in {{hash}}',
              unified: 'Unificato',
              split: 'Affiancato',
              diffLayout: 'Layout del diff',
              maximize: 'Massimizza inspector',
              restore: 'Ripristina inspector',
              close: 'Chiudi inspector',
              placeholder: 'Seleziona un commit per esaminare le modifiche.',
              loading: 'Caricamento diff…',
              noChanges: 'Nessuna modifica'
            },
            actions: {
              fetch: 'Fetch',
              pull: 'Pull',
              push: 'Push',
              refresh: 'Aggiorna',
              repositoryActions: 'Azioni repository',
              previous: 'Precedente',
              next: 'Successivo'
            },
            branchMenu: {
              checkout: 'Passa a {{branch}}…',
              alreadyCurrent: 'Questo è già il branch corrente',
              mergeIntoCurrent: 'Unisci {{branch}} nel branch corrente',
              rebaseOnto: 'Ribasa il branch corrente su {{branch}}',
              sameBranch: 'Seleziona un branch diverso da quello corrente',
              cleanRequired: 'Prima esegui commit o stash delle modifiche',
              pendingOperation: 'Completa o annulla prima il {{operation}} in corso',
              fetch: 'Fetch di {{branch}}',
              pullTracked: 'Pull del branch tracciato',
              currentOnly: 'Disponibile solo per il branch corrente',
              noUpstream: 'Nessun upstream configurato',
              pushTracked: 'Push tracciato',
              pushTo: 'Push verso…',
              trackRemote: 'Traccia branch remoto',
              noRemotes: 'Nessun remote configurato',
              noRemoteBranches: 'Nessun branch remoto disponibile',
              stashChanges: 'Metti in stash le modifiche bloccanti…',
              diffAgainstCurrent: 'Confronta con il corrente',
              rename: 'Rinomina {{branch}}…',
              renameUnavailable: 'Rinomina non disponibile',
              localOnly: 'Disponibile solo per branch locali',
              delete: 'Elimina {{branch}}…',
              deleteCurrent: 'Il branch corrente non può essere eliminato',
              createPullRequest: 'Crea pull request…',
              unsupportedProvider: 'Supportato per remote GitHub, GitLab e Bitbucket',
              operationComplete: 'Operazione sul branch completata',
              renameTitle: 'Rinomina branch',
              branchNameLabel: 'Nome branch',
              deleteTitle: 'Elimina branch',
              deleteConfirm: 'Eliminare {{branch}} in modalità sicura?',
              deleteAction: 'Elimina',
              forceDeleteTitle: 'Forza eliminazione branch',
              forceDeleteConfirm: '{{branch}} non è completamente unito. Forzare?',
              forceDeleteAction: 'Forza eliminazione',
              prTitle: 'Crea pull request',
              remoteLabel: 'Remote',
              targetLabel: 'Branch di destinazione'
            },
            conflicts: {
              operation: '{{operation}} in corso',
              title: 'Risolvi conflitti',
              remaining: 'rimanenti',
              files: 'File in conflitto',
              abort: 'Annulla operazione',
              allResolved: 'Tutti i conflitti sono risolti',
              readyContinue: 'L’operazione è pronta per continuare.',
              binary: 'Binario',
              acceptOurs: 'Accetta la nostra',
              acceptTheirs: 'Accetta la loro',
              saveResult: 'Salva risultato',
              binaryTitle: 'Conflitto binario',
              binaryHelp: 'Scegli la versione corrente o in arrivo. La modifica testuale non è disponibile.',
              base: 'Base comune',
              ours: 'Branch corrente',
              theirs: 'Branch in arrivo',
              result: 'Risultato',
              completed: 'Operazione Git completata',
              abortTitle: 'Annulla operazione',
              abortConfirm: 'Scartare l’operazione pendente e ripristinare lo stato precedente?',
              discardTitle: 'Scarta risultato non salvato',
              discardConfirm: 'Il risultato manuale contiene modifiche non salvate. Scartarle?'
            },
            updates: {
              available: 'Aggiornamento disponibile',
              availableVersion: 'GitTree {{version}} disponibile',
              downloading: 'Download {{progress}}%',
              restart: 'Riavvia e aggiorna',
              ready: 'L’aggiornamento è pronto. Riavvia GitTree per installarlo.',
              failed: 'Aggiornamento non riuscito: {{error}}'
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
    root.querySelectorAll('[data-i18n-aria-label]').forEach(element => {
      element.setAttribute('aria-label', this.t(element.dataset.i18nAriaLabel));
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
