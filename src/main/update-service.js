const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

class UpdateService {
  constructor(window) {
    this.window = window;
    this.initialized = false;
    this.timer = null;
    this.state = {
      status: app.isPackaged ? 'idle' : 'disabled',
      currentVersion: app.getVersion(),
      availableVersion: null,
      progress: 0,
      error: null
    };
  }

  setWindow(window) {
    this.window = window;
    this.broadcast();
  }

  initialize() {
    if (this.initialized) {
      this.broadcast();
      return;
    }
    this.initialized = true;
    if (!app.isPackaged) {
      this.broadcast();
      return;
    }

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = app.getVersion().includes('-');

    autoUpdater.on('checking-for-update', () => this.setState({
      status: 'checking',
      error: null
    }));
    autoUpdater.on('update-available', info => this.setState({
      status: 'available',
      availableVersion: info.version,
      progress: 0,
      error: null
    }));
    autoUpdater.on('update-not-available', () => this.setState({
      status: 'idle',
      availableVersion: null,
      progress: 0,
      error: null
    }));
    autoUpdater.on('download-progress', progress => this.setState({
      status: 'downloading',
      progress: Math.max(0, Math.min(100, Math.round(progress.percent || 0))),
      error: null
    }));
    autoUpdater.on('update-downloaded', info => this.setState({
      status: 'downloaded',
      availableVersion: info.version,
      progress: 100,
      error: null
    }));
    autoUpdater.on('error', error => this.setState({
      status: 'error',
      error: error?.message || String(error)
    }));

    setTimeout(() => this.check(false), 15000).unref?.();
    this.timer = setInterval(() => this.check(false), 6 * 60 * 60 * 1000);
    this.timer.unref?.();
    this.broadcast();
  }

  getState() {
    return { ...this.state };
  }

  async check(manual = true) {
    if (!app.isPackaged) {
      return { success: false, skipped: true, state: this.getState() };
    }
    if (['downloading', 'downloaded'].includes(this.state.status)) {
      return { success: false, skipped: true, state: this.getState() };
    }
    try {
      await autoUpdater.checkForUpdates();
      return { success: true, state: this.getState() };
    } catch (error) {
      this.setState({
        status: manual ? 'error' : 'idle',
        error: manual ? error.message : null
      });
      return { success: false, error: error.message, state: this.getState() };
    }
  }

  async download() {
    if (this.state.status !== 'available') {
      return { success: false, error: 'No update is ready to download', state: this.getState() };
    }
    try {
      await autoUpdater.downloadUpdate();
      return { success: true, state: this.getState() };
    } catch (error) {
      this.setState({ status: 'error', error: error.message });
      return { success: false, error: error.message, state: this.getState() };
    }
  }

  install() {
    if (this.state.status !== 'downloaded') {
      return { success: false, error: 'No downloaded update is ready to install' };
    }
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return { success: true };
  }

  setState(patch) {
    this.state = { ...this.state, ...patch };
    this.broadcast();
  }

  broadcast() {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send('update:state', this.getState());
  }
}

module.exports = UpdateService;
