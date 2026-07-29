class SettingsView {
  constructor(app) {
    this.app = app;
    this.overlay = document.getElementById('modal-overlay');
    this.dialog = document.getElementById('modal-dialog');
    this.autoFetchStorageKey = 'gittree.settings.autoFetch';
    this.profilesStorageKey = 'gittree.settings.gitProfiles';
    this.assignmentsStorageKey = 'gittree.settings.profileAssignments';
    this.inFlight = new Set();
    this.timer = null;
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.dialog.classList.contains('settings-dialog')) {
        event.preventDefault();
        this.close();
      }
    });
  }

  init() {
    if (this.timer) return;
    this.timer = window.setInterval(() => this.tick(), 30000);
  }

  async open() {
    const repo = this.app.state.repo;
    let metadata = this.app.components.branchList?.metadata;
    if (repo && !metadata) {
      const response = await window.gitTree.getBranchMetadata(repo.path);
      metadata = response?.error ? null : response;
    }
    const schedules = this.readObject(this.autoFetchStorageKey);
    let profiles = this.readArray(this.profilesStorageKey);
    const assignments = this.readObject(this.assignmentsStorageKey);
    const identity = repo ? await this.readRepositoryIdentity(repo.path) : null;
    if (repo && identity?.configured) {
      const imported = this.importConfiguredProfile(profiles, assignments, repo.path, identity);
      profiles = imported.profiles;
      if (imported.changed) {
        localStorage.setItem(this.profilesStorageKey, JSON.stringify(profiles));
        localStorage.setItem(this.assignmentsStorageKey, JSON.stringify(assignments));
      }
    }
    const repoSchedule = repo
      ? this.readProjectSchedule(schedules[repo.path], metadata)
      : {};
    const assignedProfile = repo ? assignments[repo.path] : '';

    this.dialog.className = 'confirm-dialog settings-dialog';
    this.dialog.innerHTML = `
      <div class="settings-header">
        <div>
          <span class="eyebrow">${this.esc(t('settings.eyebrow'))}</span>
          <h2>${this.esc(t('settings.title'))}</h2>
        </div>
        <button class="btn-icon" type="button" data-settings-close
          title="${this.esc(t('common.close'))}" aria-label="${this.esc(t('common.close'))}">
          <i class="ph ph-x" aria-hidden="true"></i>
        </button>
      </div>
      <div class="settings-scroll">
        <section class="settings-section" data-settings-section="auto-fetch">
          <div class="settings-section-heading">
            <i class="ph ph-arrows-clockwise" aria-hidden="true"></i>
            <div>
              <h3>${this.esc(t('settings.autoFetchTitle'))}</h3>
              <p>${this.esc(t('settings.autoFetchHelp'))}</p>
            </div>
          </div>
          <div class="settings-project-fetch">
            ${repo
              ? this.renderProjectSchedule(repoSchedule, metadata)
              : `<div class="settings-empty">${this.esc(t('settings.openRepositoryFirst'))}</div>`}
          </div>
        </section>

        <section class="settings-section settings-navigation-section"
          data-settings-section="shortcuts">
          <button class="settings-navigation-row" type="button" data-settings-shortcuts>
            <i class="ph ph-keyboard" aria-hidden="true"></i>
            <div>
              <strong>${this.esc(t('settings.shortcutsTitle'))}</strong>
              <span>${this.esc(t('settings.shortcutsHelp'))}</span>
            </div>
            <i class="ph ph-caret-right settings-navigation-caret" aria-hidden="true"></i>
          </button>
        </section>

        <section class="settings-section" data-settings-section="accounts">
          <div class="settings-section-heading">
            <i class="ph ph-users-three" aria-hidden="true"></i>
            <div>
              <h3>${this.esc(t('settings.accountsTitle'))}</h3>
              <p>${this.esc(t('settings.accountsHelp'))}</p>
            </div>
          </div>
          <div class="settings-profile-list">
            ${profiles.map(profile => this.renderProfile(
                profile,
                assignedProfile,
                Boolean(repo)
              )).join('') || `<div class="settings-empty">${this.esc(t('settings.noProfiles'))}</div>`}
          </div>
          <form id="settings-account-form" class="settings-account-form">
            <input name="label" maxlength="80" required
              placeholder="${this.esc(t('settings.profileLabel'))}">
            <input name="name" maxlength="200" required
              placeholder="${this.esc(t('settings.gitName'))}">
            <input name="email" type="email" maxlength="254" required
              placeholder="${this.esc(t('settings.gitEmail'))}">
            <button class="btn btn-primary" type="submit">
              <i class="ph ph-plus" aria-hidden="true"></i>
              ${this.esc(t('settings.addProfile'))}
            </button>
          </form>
        </section>

        <section class="settings-section" data-settings-section="about">
          <div class="settings-section-heading">
            <i class="ph ph-info" aria-hidden="true"></i>
            <div>
              <h3>About</h3>
              <p class="settings-about-version">GitTree <span id="about-version">—</span> — Beta</p>
            </div>
          </div>
          <div class="settings-about-body">
            <p>A fast, visual Git desktop client. Open source under the ISC license.</p>
            <p>Created by <strong>Lorenzo Giannoccaro</strong> &lt;lorenzo.giannoccaro998@gmail.com&gt;</p>
            <p class="settings-about-repo">
              <a href="#" id="about-repo-link">github.com/LorenzoGit98/gittree-minimal</a>
            </p>
            <div class="settings-update-row">
              <button class="btn btn-small" id="btn-check-update" type="button">
                <i class="ph ph-arrows-clockwise" aria-hidden="true"></i>
                <span data-i18n="settings.checkUpdate">Check for updates</span>
              </button>
              <span id="check-update-status" class="settings-update-status"></span>
            </div>
          </div>
        </section>
      </div>
    `;
    this.overlay.classList.remove('is-hidden');
    this.bindSettingsEvents(repo, metadata);
    this.populateVersion();
    this.dialog.querySelector('[data-settings-close]')?.focus();
  }

  close() {
    this.overlay.classList.add('is-hidden');
    this.overlay.onclick = null;
    this.dialog.className = 'confirm-dialog';
    this.dialog.innerHTML = '';
  }

  async populateVersion() {
    const el = document.getElementById('about-version');
    if (el && window.gitTree.getAppVersion) {
      const v = await window.gitTree.getAppVersion();
      el.textContent = v;
    }
  }

  renderProjectSchedule(schedule = {}, metadata = {}) {
    const enabled = Boolean(schedule.enabled);
    const interval = Number(schedule.intervalMinutes) || 15;
    const remotes = metadata.remotes || [];
    return `<div class="settings-project-controls">
      <label class="settings-switch">
        <input type="checkbox" data-auto-fetch-project${enabled ? ' checked' : ''}>
        <span aria-hidden="true"></span>
      </label>
      <div class="settings-project-copy">
        <strong>${this.esc(t('settings.projectFetch'))}</strong>
        <small>${this.esc(t('settings.projectFetchDetail'))}</small>
      </div>
      <label class="settings-interval">
        <span>${this.esc(t('settings.every'))}</span>
        <select data-auto-fetch-project-interval>
          ${[1, 5, 10, 15, 30, 60].map(value => `
            <option value="${value}"${value === interval ? ' selected' : ''}>
              ${this.esc(t('settings.minutes', { count: value }))}
            </option>`).join('')}
        </select>
      </label>
      <label class="settings-remote">
        <span>${this.esc(t('settings.remote'))}</span>
        <select data-auto-fetch-project-remote>
          ${remotes.map(remote => `<option value="${this.esc(remote.name)}"${
            remote.name === schedule.remote ? ' selected' : ''
          }>${this.esc(remote.name)}</option>`).join('')}
        </select>
      </label>
    </div>`;
  }

  renderProfile(profile, assignedProfile, hasRepository) {
    const assigned = profile.id === assignedProfile;
    return `<div class="settings-profile${assigned ? ' is-assigned' : ''}">
      <div class="settings-profile-avatar" aria-hidden="true">
        ${this.esc((profile.label || profile.name || '?').slice(0, 1).toUpperCase())}
      </div>
      <div class="settings-profile-copy">
        <strong>${this.esc(profile.label)}</strong>
        <span>${this.esc(profile.name)} · ${this.esc(profile.email)}</span>
      </div>
      ${profile.source === 'git-config'
        ? `<span class="badge badge-remote">${this.esc(t('settings.detected'))}</span>`
        : ''}
      ${assigned
        ? `<span class="badge badge-head">${this.esc(t('settings.assigned'))}</span>`
        : `<button class="btn btn-small" type="button" data-profile-apply="${this.esc(profile.id)}"
            ${hasRepository ? '' : 'disabled'}>${this.esc(t('settings.useForRepository'))}</button>`}
      <button class="btn-icon settings-profile-delete" type="button"
        data-profile-delete="${this.esc(profile.id)}"
        title="${this.esc(t('settings.deleteProfile'))}"
        aria-label="${this.esc(t('settings.deleteProfile'))}">
        <i class="ph ph-trash" aria-hidden="true"></i>
      </button>
    </div>`;
  }

  openShortcuts() {
    this.dialog.className = 'confirm-dialog settings-dialog';
    this.dialog.innerHTML = `
      <div class="settings-header">
        <div class="settings-page-title">
          <button class="btn-icon" type="button" data-shortcuts-back
            title="${this.esc(t('settings.backToSettings'))}"
            aria-label="${this.esc(t('settings.backToSettings'))}">
            <i class="ph ph-arrow-left" aria-hidden="true"></i>
          </button>
          <div>
            <span class="eyebrow">${this.esc(t('settings.eyebrow'))}</span>
            <h2>${this.esc(t('settings.shortcutsTitle'))}</h2>
          </div>
        </div>
        <button class="btn-icon" type="button" data-settings-close
          title="${this.esc(t('common.close'))}" aria-label="${this.esc(t('common.close'))}">
          <i class="ph ph-x" aria-hidden="true"></i>
        </button>
      </div>
      <div class="settings-scroll">
        <div class="settings-shortcut-intro">
          <i class="ph ph-info" aria-hidden="true"></i>
          <p>${this.esc(t('settings.shortcutsGuide'))}</p>
        </div>
        <section class="settings-section">
          <div class="settings-section-heading">
            <i class="ph ph-git-branch" aria-hidden="true"></i>
            <div>
              <h3>${this.esc(t('settings.repositoryShortcuts'))}</h3>
              <p>${this.esc(t('settings.repositoryShortcutsHelp'))}</p>
            </div>
          </div>
          <div class="settings-shortcut-list">
            ${this.renderShortcut(t('actions.fetch'), 'fetch', t('settings.fetchShortcutHelp'))}
            ${this.renderShortcut(t('actions.pull'), 'pull', t('settings.pullShortcutHelp'))}
            ${this.renderShortcut(t('actions.push'), 'push', t('settings.pushShortcutHelp'))}
            ${this.renderShortcut(t('sidebar.newBranch'), 'newBranch', t('settings.branchShortcutHelp'))}
            ${this.renderShortcut(t('actions.refresh'), 'refresh', t('settings.refreshShortcutHelp'))}
          </div>
        </section>
        <section class="settings-section">
          <div class="settings-section-heading">
            <i class="ph ph-navigation-arrow" aria-hidden="true"></i>
            <div>
              <h3>${this.esc(t('settings.navigationShortcuts'))}</h3>
            </div>
          </div>
          <div class="settings-shortcut-list">
            ${this.renderShortcut(t('welcome.open'), 'open', t('settings.openShortcutHelp'))}
            ${this.renderShortcut(t('search.trigger'), 'search', t('settings.searchShortcutHelp'))}
          </div>
        </section>
      </div>`;
    this.overlay.classList.remove('is-hidden');
    this.dialog.querySelector('[data-shortcuts-back]').onclick = () => this.open();
    this.dialog.querySelector('[data-settings-close]').onclick = () => this.close();
    this.overlay.onclick = event => {
      if (event.target === this.overlay) this.close();
    };
    this.dialog.querySelector('[data-shortcuts-back]').focus();
  }

  renderShortcut(label, action, description) {
    return `<div class="settings-shortcut-row">
      <span class="settings-shortcut-copy">
        <strong>${this.esc(label)}</strong>
        <small>${this.esc(description)}</small>
      </span>
      <kbd>${this.esc(this.app.shortcutLabel(action))}</kbd>
    </div>`;
  }

  bindSettingsEvents(repo, metadata) {
    this.dialog.querySelector('[data-settings-close]').onclick = () => this.close();
    this.dialog.querySelector('[data-settings-shortcuts]').onclick = () => this.openShortcuts();
    this.overlay.onclick = event => {
      if (event.target === this.overlay) this.close();
    };

    const projectToggle = this.dialog.querySelector('[data-auto-fetch-project]');
    const projectInterval = this.dialog.querySelector('[data-auto-fetch-project-interval]');
    const projectRemote = this.dialog.querySelector('[data-auto-fetch-project-remote]');
    const saveProject = () => this.saveProjectSchedule(
      repo,
      projectRemote?.value,
      projectToggle?.checked,
      projectInterval?.value
    );
    if (projectToggle) projectToggle.onchange = saveProject;
    if (projectInterval) projectInterval.onchange = saveProject;
    if (projectRemote) projectRemote.onchange = saveProject;

    this.dialog.querySelector('#settings-account-form').onsubmit = event => {
      event.preventDefault();
      const form = event.currentTarget;
      const profiles = this.readArray(this.profilesStorageKey);
      profiles.push({
        id: crypto.randomUUID(),
        label: form.elements.label.value.trim(),
        name: form.elements.name.value.trim(),
        email: form.elements.email.value.trim()
      });
      localStorage.setItem(this.profilesStorageKey, JSON.stringify(profiles));
      this.open();
    };
    this.dialog.querySelectorAll('[data-profile-apply]').forEach(button => {
      button.onclick = async () => {
        const profile = this.readArray(this.profilesStorageKey)
          .find(item => item.id === button.dataset.profileApply);
        if (!repo || !profile) return;
        const result = await window.gitTree.setIdentity(repo.path, {
          name: profile.name,
          email: profile.email,
          scope: 'local'
        });
        if (result?.error) {
          this.app.showToast(result.error, 'error');
          return;
        }
        const assignments = this.readObject(this.assignmentsStorageKey);
        assignments[repo.path] = profile.id;
        localStorage.setItem(this.assignmentsStorageKey, JSON.stringify(assignments));
        this.app.showToast(t('settings.profileApplied'), 'success');
        await this.open();
      };
    });
    this.dialog.querySelectorAll('[data-profile-delete]').forEach(button => {
      button.onclick = () => {
        const id = button.dataset.profileDelete;
        const profiles = this.readArray(this.profilesStorageKey).filter(item => item.id !== id);
        const assignments = this.readObject(this.assignmentsStorageKey);
        Object.keys(assignments).forEach(path => {
          if (assignments[path] === id) delete assignments[path];
        });
        localStorage.setItem(this.profilesStorageKey, JSON.stringify(profiles));
        localStorage.setItem(this.assignmentsStorageKey, JSON.stringify(assignments));
        this.open();
      };
    });

    const checkUpdateBtn = this.dialog.querySelector('#btn-check-update');
    const checkUpdateStatus = this.dialog.querySelector('#check-update-status');
    if (checkUpdateBtn) {
      checkUpdateBtn.onclick = async () => {
        checkUpdateBtn.disabled = true;
        checkUpdateStatus.textContent = t('settings.checking');
        try {
          const result = await window.gitTree.checkForUpdates();
          if (result?.error) {
            checkUpdateStatus.textContent = result.error;
          } else {
            checkUpdateStatus.textContent = t('settings.upToDate');
            this.app.showToast(t('settings.upToDate'), 'success');
          }
        } catch (err) {
          checkUpdateStatus.textContent = err.message || t('common.error');
        } finally {
          checkUpdateBtn.disabled = false;
        }
      };
      this.unsubscribeUpdateState?.();
      this.unsubscribeUpdateState = window.gitTree.onUpdateState(state => {
        if (!checkUpdateStatus) return;
        if (state.status === 'available') {
          checkUpdateStatus.textContent = t('settings.updateAvailable');
        } else if (state.status === 'downloading') {
          checkUpdateStatus.textContent = t('settings.downloading');
        } else if (state.status === 'downloaded') {
          checkUpdateStatus.textContent = t('settings.updateReady');
        }
      });
    }
  }

  saveProjectSchedule(repo, remote, enabled, intervalMinutes) {
    if (!repo || !remote) return;
    const schedules = this.readObject(this.autoFetchStorageKey);
    const minutes = Math.min(60, Math.max(1, Number(intervalMinutes) || 15));
    schedules[repo.path] = {
      enabled: Boolean(enabled),
      intervalMinutes: minutes,
      remote,
      nextRunAt: Date.now() + (minutes * 60000)
    };
    localStorage.setItem(this.autoFetchStorageKey, JSON.stringify(schedules));
  }

  async readRepositoryIdentity(repoPath) {
    try {
      const identity = await window.gitTree.getIdentity(repoPath);
      return identity?.error ? null : identity;
    } catch {
      return null;
    }
  }

  importConfiguredProfile(profiles, assignments, repoPath, identity) {
    const name = String(identity.name || '').trim();
    const email = String(identity.email || '').trim();
    if (!name || !email) return { profiles, changed: false };
    const normalizedEmail = email.toLowerCase();
    let changed = false;
    let profile = profiles.find(item => (
      item.source === 'git-config' &&
      String(item.email || '').toLowerCase() === normalizedEmail
    ));
    if (profile) {
      if (profile.name !== name) { profile.name = name; changed = true; }
      const expectedLabel = identity.nameSource === 'local'
        ? 'Repository Git config'
        : 'Global Git config';
      if (profile.label !== expectedLabel) { profile.label = expectedLabel; changed = true; }
    } else {
      profile = {
        id: `git-config:${encodeURIComponent(normalizedEmail)}`,
        label: identity.nameSource === 'local' ? 'Repository Git config' : 'Global Git config',
        name,
        email,
        source: 'git-config'
      };
      profiles.push(profile);
      changed = true;
    }
    const assignment = assignments[repoPath];
    const assignedProfile = profiles.find(item => item.id === assignment);
    if (!assignedProfile) {
      assignments[repoPath] = profile.id;
      changed = true;
    }
    return { profiles, changed };
  }

  async tick(now = Date.now()) {
    const schedules = this.readObject(this.autoFetchStorageKey);
    let changed = false;
    const refreshedRepositories = new Set();
    for (const [repoPath, schedule] of Object.entries(schedules)) {
      if (!schedule || !schedule.enabled || schedule.nextRunAt > now) continue;
      const key = repoPath;
      if (this.inFlight.has(key)) continue;
      this.inFlight.add(key);
      try {
        const result = await window.gitTree.fetch(repoPath, schedule.remote);
        if (result?.error && this.app.state.repo?.path === repoPath) {
          this.app.showToast(result.error, 'error');
        }
        if (!result?.error) refreshedRepositories.add(repoPath);
      } catch (error) {
        if (this.app.state.repo?.path === repoPath) {
          this.app.showToast(error.message, 'error');
        }
      } finally {
        schedule.nextRunAt = Date.now() + (schedule.intervalMinutes * 60000);
        this.inFlight.delete(key);
        changed = true;
      }
    }
    if (changed) localStorage.setItem(this.autoFetchStorageKey, JSON.stringify(schedules));
    if (this.app.state.repo && refreshedRepositories.has(this.app.state.repo.path)) {
      await this.app.refresh({ silent: true });
    }
  }

  readProjectSchedule(value, metadata = {}) {
    if (value && typeof value.enabled === 'boolean') return value;
    const legacy = Object.values(value || {}).find(item => item?.enabled);
    if (legacy) return {
      enabled: true,
      intervalMinutes: legacy.intervalMinutes || 15,
      remote: legacy.remote || (metadata.remotes || [])[0]?.name || '',
      nextRunAt: legacy.nextRunAt || Date.now()
    };
    return {
      enabled: false,
      intervalMinutes: 15,
      remote: (metadata.remotes || [])[0]?.name || ''
    };
  }

  readArray(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  readObject(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  esc(value) {
    const element = document.createElement('div');
    element.textContent = value ?? '';
    return element.innerHTML;
  }
}
