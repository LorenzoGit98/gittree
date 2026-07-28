const { app, BrowserWindow, ipcMain, dialog, Menu, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const GitService = require('./git-service');
const RepoManager = require('./repo-manager');

let mainWindow;
let repoManager;

const gitServices = new Map();

function getGitService(repoPath) {
  if (!gitServices.has(repoPath)) {
    gitServices.set(repoPath, new GitService(repoPath));
  }
  return gitServices.get(repoPath);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#f7f9fc',
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

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
    const safeTheme = theme === 'dark' ? 'dark' : 'light';
    nativeTheme.themeSource = safeTheme;
    if (mainWindow) mainWindow.setBackgroundColor(safeTheme === 'dark' ? '#121a27' : '#f7f9fc');
    return safeTheme;
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

  ipcMain.handle('git:merge', async (_event, repoPath, branch) => {
    try {
      const git = getGitService(repoPath);
      const result = await git.merge(branch);
      sendToRenderer('operation:log', `Merged ${branch}`);
      return result;
    } catch (err) {
      return { error: err.message };
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

  ipcMain.handle('git:push', async (_event, repoPath, remote, branch) => {
    try {
      const git = getGitService(repoPath);
      const result = await git.push(remote, branch);
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
  nativeTheme.themeSource = 'light';
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
