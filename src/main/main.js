const { app, BrowserWindow, ipcMain, dialog, Menu, nativeTheme, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const GitService = require('./git-service');
const RepoManager = require('./repo-manager');
const UpdateService = require('./update-service');
const { buildPullRequestUrl } = require('./provider-links');

let mainWindow;
let repoManager;
let updateService;

const gitServices = new Map();

function getGitService(repoPath) {
  if (!gitServices.has(repoPath)) {
    gitServices.set(repoPath, new GitService(repoPath));
  }
  return gitServices.get(repoPath);
}

function createWindow() {
  const iconPath = app.isPackaged
    ? path.join(app.getAppPath(), 'icon.png')
    : path.join(__dirname, '..', '..', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#f7f9fc',
    frame: false,
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (updateService) updateService.setWindow(mainWindow);
  else updateService = new UpdateService(mainWindow);
  mainWindow.webContents.once('did-finish-load', () => updateService.initialize());

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu() {
  Menu.setApplicationMenu(null);
}

function sendToRenderer(channel, data) {
  if (mainWindow) {
    mainWindow.webContents.send(channel, data);
  }
}

async function openRepoDialog() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    const dirPath = result.filePaths[0];
    try {
      const testGit = new GitService(dirPath);
      await testGit.git.checkIsRepo();
      const repo = repoManager.addRepo(dirPath);
      sendToRenderer('repo:added', repo);
    } catch {
      dialog.showErrorBox('Not a Git Repository', `"${dirPath}" is not a valid Git repository.`);
    }
  }
}

function closeActiveRepo() {
  const active = repoManager.getActiveRepo();
  if (active) {
    repoManager.removeRepo(active.path);
    gitServices.delete(active.path);
    sendToRenderer('repo:removed', active.path);
    const newActive = repoManager.getActiveRepo();
    sendToRenderer('repo:changed', newActive);
  }
}

function registerIpcHandlers() {
  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });

  ipcMain.handle('window:close', () => {
    mainWindow?.close();
  });

  ipcMain.handle('app:set-theme', (_event, theme) => {
    const safeTheme = ['dark', 'black'].includes(theme) ? theme : 'light';
    nativeTheme.themeSource = safeTheme === 'light' ? 'light' : 'dark';
    if (mainWindow) {
      const background = safeTheme === 'black'
        ? '#000000'
        : (safeTheme === 'dark' ? '#121a27' : '#f7f9fc');
      mainWindow.setBackgroundColor(background);
    }
    return safeTheme;
  });

  ipcMain.handle('update:get-state', () => {
    return updateService?.getState() || {
      status: app.isPackaged ? 'idle' : 'disabled',
      currentVersion: app.getVersion()
    };
  });

  ipcMain.handle('update:check', () => {
    return updateService?.check(true) || { success: false, error: 'Updater is not ready' };
  });

  ipcMain.handle('update:download', () => {
    return updateService?.download() || { success: false, error: 'Updater is not ready' };
  });

  ipcMain.handle('update:install', () => {
    return updateService?.install() || { success: false, error: 'Updater is not ready' };
  });

  ipcMain.handle('dialog:select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('git:is-repo', async (_event, repoPath) => {
    try {
      const git = getGitService(repoPath);
      await git.git.checkIsRepo();
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('git:log', async (_event, repoPath, maxCount, branch) => {
    try {
      const git = getGitService(repoPath);
      return await git.getLog(maxCount, branch);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:graph-page', async (_event, repoPath, offset, limit) => {
    try {
      return await getGitService(repoPath).getGraphPage(offset, limit);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:diff', async (_event, repoPath, commitHash, file) => {
    try {
      const git = getGitService(repoPath);
      return await git.getDiff(commitHash, file);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:commit-detail', async (_event, repoPath, hash) => {
    try {
      const git = getGitService(repoPath);
      return await git.getCommitDetail(hash);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:branches', async (_event, repoPath) => {
    try {
      const git = getGitService(repoPath);
      return await git.getBranches();
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:branch-metadata', async (_event, repoPath) => {
    try {
      return await getGitService(repoPath).getBranchMetadata();
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:branch-compare', async (_event, repoPath, baseBranch, compareBranch) => {
    try {
      return await getGitService(repoPath).getBranchComparison(baseBranch, compareBranch);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:checkout', async (_event, repoPath, branch) => {
    try {
      const git = getGitService(repoPath);
      const result = await git.checkoutBranch(branch);
      sendToRenderer('operation:log', `Checked out ${branch}`);
      return result;
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:checkout-tracking', async (_event, repoPath, remoteRef) => {
    try {
      const result = await getGitService(repoPath).checkoutTrackingBranch(remoteRef);
      sendToRenderer('operation:log', `Checked out ${result.branch}`);
      return result;
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:branch-rename', async (_event, repoPath, branch, newName) => {
    try {
      const result = await getGitService(repoPath).renameBranch(branch, newName);
      sendToRenderer('operation:log', `Renamed ${branch} to ${newName}`);
      return result;
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:branch-rebase', async (_event, repoPath, branch) => {
    const git = getGitService(repoPath);
    try {
      const result = await git.rebaseOnto(branch);
      sendToRenderer('operation:log', `Rebased onto ${branch}`);
      return result;
    } catch (err) {
      return { error: err.message, conflictState: await git.getOperationState() };
    }
  });

  ipcMain.handle('git:branch-track', async (_event, repoPath, branch, remoteRef) => {
    try {
      return await getGitService(repoPath).trackBranch(branch, remoteRef);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:branch-fetch', async (_event, repoPath, remote, branch) => {
    try {
      return await getGitService(repoPath).fetchBranch(remote, branch);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:branch-delete-remote', async (_event, repoPath, remote, branch) => {
    try {
      return await getGitService(repoPath).deleteRemoteBranch(remote, branch);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:create-branch', async (_event, repoPath, name, startPoint) => {
    try {
      const git = getGitService(repoPath);
      const result = await git.createBranch(name, startPoint);
      sendToRenderer('operation:log', `Created branch ${name}`);
      return result;
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:merge', async (_event, repoPath, branch, strategy) => {
    const git = getGitService(repoPath);
    try {
      const result = await git.merge(branch, strategy);
      sendToRenderer('operation:log', `Merged ${branch}`);
      return result;
    } catch (err) {
      return { error: err.message, conflictState: await git.getOperationState() };
    }
  });

  ipcMain.handle('git:delete-branch', async (_event, repoPath, branch, force) => {
    try {
      const git = getGitService(repoPath);
      return await git.deleteBranch(branch, force);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:push', async (_event, repoPath, remote, branch, setUpstream) => {
    try {
      const git = getGitService(repoPath);
      const result = await git.push(remote, branch, setUpstream);
      sendToRenderer('operation:log', `Pushed to ${remote}`);
      return result;
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:pull', async (_event, repoPath, remote, branch) => {
    try {
      const git = getGitService(repoPath);
      const result = await git.pull(remote, branch);
      sendToRenderer('operation:log', `Pulled from ${remote}`);
      return result;
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:fetch', async (_event, repoPath, remote) => {
    try {
      const git = getGitService(repoPath);
      const result = await git.fetch(remote);
      sendToRenderer('operation:log', `Fetched from ${remote}`);
      return result;
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:status', async (_event, repoPath) => {
    try {
      const git = getGitService(repoPath);
      return await git.getStatus();
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:stash-list', async (_event, repoPath) => {
    try {
      const git = getGitService(repoPath);
      return await git.getStashList();
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:stash', async (_event, repoPath, message) => {
    try {
      const git = getGitService(repoPath);
      return await git.stash(message);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:stash-pop', async (_event, repoPath, index) => {
    try {
      const git = getGitService(repoPath);
      return await git.stashPop(index);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:remotes', async (_event, repoPath) => {
    try {
      const git = getGitService(repoPath);
      return await git.getRemotes();
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:file-tree', async (_event, repoPath, commitHash) => {
    try {
      const git = getGitService(repoPath);
      return await git.getFileTree(commitHash);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:tags', async (_event, repoPath) => {
    try {
      const git = getGitService(repoPath);
      return await git.getTags();
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:operation-state', async (_event, repoPath) => {
    try {
      return await getGitService(repoPath).getOperationState();
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:conflict-read', async (_event, repoPath, filePath) => {
    try {
      return await getGitService(repoPath).readConflict(filePath);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:conflict-resolve', async (_event, repoPath, filePath, resolution) => {
    try {
      return await getGitService(repoPath).resolveConflict(filePath, resolution);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:operation-continue', async (_event, repoPath) => {
    try {
      return await getGitService(repoPath).continueOperation();
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:operation-abort', async (_event, repoPath) => {
    try {
      return await getGitService(repoPath).abortOperation();
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle(
    'app:open-pull-request',
    async (_event, repoPath, remoteName, sourceBranch, targetBranch) => {
      try {
        const git = getGitService(repoPath);
        await git.assertValidBranchName(sourceBranch);
        await git.assertValidBranchName(targetBranch);
        const metadata = await git.getBranchMetadata();
        const remote = metadata.remotes.find(item => item.name === remoteName);
        if (!remote) return { error: 'Remote not found' };
        const url = buildPullRequestUrl(remote?.provider, sourceBranch, targetBranch);
        if (!url) return { error: 'Pull requests are not supported for this remote provider' };
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:') return { error: 'Unsafe pull request URL' };
        await shell.openExternal(url);
        return { success: true, url };
      } catch (err) {
        return { error: err.message };
      }
    }
  );

  ipcMain.handle('repo:list', () => {
    return repoManager.getAllRepos();
  });

  ipcMain.handle('repo:add', async (_event, repoPath) => {
    try {
      const testGit = new GitService(repoPath);
      await testGit.git.checkIsRepo();
    } catch {
      return { error: 'Not a valid Git repository' };
    }
    return repoManager.addRepo(repoPath);
  });

  ipcMain.handle('repo:remove', (_event, repoPath) => {
    const result = repoManager.removeRepo(repoPath);
    if (result) gitServices.delete(repoPath);
    return repoManager.getActiveRepo();
  });

  ipcMain.handle('repo:set-active', (_event, index) => {
    return repoManager.setActiveRepo(index);
  });

  ipcMain.handle('repo:active', () => {
    return repoManager.getActiveRepo();
  });
}

app.whenReady().then(() => {
  app.setName('GitTree');
  app.setAppUserModelId('com.lorenzogit.gittree');
  nativeTheme.themeSource = 'light';
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(path.join(__dirname, '..', '..', 'icon.png'));
  }
  repoManager = new RepoManager();
  registerIpcHandlers();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
