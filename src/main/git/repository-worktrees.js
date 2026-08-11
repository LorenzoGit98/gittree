const path = require('node:path');

function assertDirectory(directory) {
  if (
    typeof directory !== 'string' ||
    !path.isAbsolute(directory) ||
    /[\0\r\n]/.test(directory)
  ) {
    throw new Error('Invalid worktree directory');
  }
  return path.normalize(directory);
}

function parseReason(line, prefix) {
  return line.length > prefix.length ? line.slice(prefix.length).trim() : '';
}

class RepositoryWorktrees {
  constructor({
    git,
    repoPath,
    readStatus = null,
    assertNoPendingOperation,
    assertValidBranchName,
    assertCommitish
  }) {
    this.git = git;
    this.repoPath = repoPath;
    this.readStatus = readStatus;
    this.assertNoPendingOperation = assertNoPendingOperation;
    this.assertValidBranchName = assertValidBranchName;
    this.assertCommitish = assertCommitish;
  }

  parse(raw) {
    const worktrees = [];
    let current = null;
    const finish = () => {
      if (!current) return;
      worktrees.push({
        path: current.path || '',
        head: current.head || '',
        branch: current.branch || '',
        detached: Boolean(current.detached),
        locked: Boolean(current.locked),
        lockReason: current.lockReason || '',
        prunable: Boolean(current.prunable),
        pruneReason: current.pruneReason || ''
      });
      current = null;
    };
    for (const line of String(raw || '').split(/\r?\n/)) {
      if (line.startsWith('worktree ')) {
        finish();
        current = { path: line.slice('worktree '.length) };
      } else if (!current) {
        continue;
      } else if (line.startsWith('HEAD ')) {
        current.head = line.slice('HEAD '.length);
      } else if (line.startsWith('branch ')) {
        current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
      } else if (line === 'detached') {
        current.detached = true;
      } else if (line === 'locked' || line.startsWith('locked ')) {
        current.locked = true;
        current.lockReason = parseReason(line, 'locked');
      } else if (line === 'prunable' || line.startsWith('prunable ')) {
        current.prunable = true;
        current.pruneReason = parseReason(line, 'prunable');
      }
    }
    finish();
    return worktrees;
  }

  async list() {
    try {
      const worktrees = this.parse(await this.git.raw(['worktree', 'list', '--porcelain']));
      if (!this.readStatus) return worktrees;
      return Promise.all(worktrees.map(async worktree => ({
        ...worktree,
        ...(await this.readStatus(worktree.path))
      })));
    } catch (error) {
      throw new Error(`Failed to get worktrees: ${error.message}`, { cause: error });
    }
  }

  parseStatus(raw) {
    let ahead = 0;
    let behind = 0;
    let changes = 0;
    for (const line of String(raw || '').split(/\r?\n/)) {
      const branch = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line);
      if (branch) {
        ahead = Number(branch[1]);
        behind = Number(branch[2]);
      } else if (/^(?:1 |2 |u |\? )/.test(line)) {
        changes += 1;
      }
    }
    return { dirty: changes > 0, changes, ahead, behind };
  }

  async create({ directory, branch, baseRef = 'HEAD', createBranch = true }) {
    await this.assertNoPendingOperation();
    const safeDirectory = assertDirectory(directory);
    await this.assertValidBranchName(branch);
    if (createBranch) await this.assertCommitish(baseRef);
    const args = createBranch
      ? ['worktree', 'add', '-b', branch, safeDirectory, baseRef]
      : ['worktree', 'add', safeDirectory, branch];
    try {
      await this.git.raw(args);
      return {
        success: true,
        path: safeDirectory,
        branch,
        baseRef: createBranch ? baseRef : branch,
        createdBranch: Boolean(createBranch)
      };
    } catch (error) {
      throw new Error(`Failed to create worktree: ${error.message}`, { cause: error });
    }
  }

  async remove(directory) {
    const safeDirectory = assertDirectory(directory);
    try {
      await this.git.raw(['worktree', 'remove', safeDirectory]);
      return { success: true, path: safeDirectory };
    } catch (error) {
      throw new Error(`Failed to remove worktree: ${error.message}`, { cause: error });
    }
  }

  async lock(directory, reason = '') {
    const safeDirectory = assertDirectory(directory);
    if (typeof reason !== 'string' || reason.length > 200 || /[\0\r\n]/.test(reason)) {
      throw new Error('Invalid worktree lock reason');
    }
    const args = ['worktree', 'lock'];
    if (reason.trim()) args.push('--reason', reason.trim());
    args.push(safeDirectory);
    try {
      await this.git.raw(args);
      return { success: true, path: safeDirectory, locked: true };
    } catch (error) {
      throw new Error(`Failed to lock worktree: ${error.message}`, { cause: error });
    }
  }

  async unlock(directory) {
    const safeDirectory = assertDirectory(directory);
    try {
      await this.git.raw(['worktree', 'unlock', safeDirectory]);
      return { success: true, path: safeDirectory, locked: false };
    } catch (error) {
      throw new Error(`Failed to unlock worktree: ${error.message}`, { cause: error });
    }
  }
}

module.exports = RepositoryWorktrees;
