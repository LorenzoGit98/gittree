const simpleGit = require('simple-git');

class GitService {
  constructor(repoPath) {
    this.git = simpleGit(repoPath);
    this.repoPath = repoPath;
  }

  async getLog(maxCount = 100, branch = null) {
    try {
      const options = { maxCount, '--date': 'iso' };
      if (branch) options[branch] = null;
      const log = await this.git.log(options);
      return log;
    } catch (err) {
      throw new Error(`Failed to get log: ${err.message}`);
    }
  }

  async getDiff(commitHash = null, file = null) {
    try {
      const options = [];
      if (commitHash) {
        options.push(`${commitHash}^..${commitHash}`);
      }
      if (file) {
        options.push('--', file);
      }
      const diff = await this.git.diff(options);
      return diff;
    } catch (err) {
      throw new Error(`Failed to get diff: ${err.message}`);
    }
  }

  async getCommitDetail(hash) {
    try {
      const log = await this.git.log({ maxCount: 1, '--date': 'iso', [hash]: null });
      if (!log.latest) return null;
      const diff = await this.git.diff([`${hash}^..${hash}`]);
      const show = await this.git.show([hash, '--stat', '--format=']);
      return {
        hash: log.latest.hash,
        message: log.latest.message,
        author_name: log.latest.author_name,
        author_email: log.latest.author_email,
        date: log.latest.date,
        diff: diff,
        files: show.trim().split('\n').filter(Boolean)
      };
    } catch (err) {
      throw new Error(`Failed to get commit detail: ${err.message}`);
    }
  }

  async getBranches() {
    try {
      const result = await this.git.branch(['-a']);
      return {
        current: result.current,
        all: result.all,
        branches: result.branches
      };
    } catch (err) {
      throw new Error(`Failed to get branches: ${err.message}`);
    }
  }

  async checkoutBranch(branch) {
    try {
      await this.git.checkout(branch);
      return { success: true, branch };
    } catch (err) {
      throw new Error(`Failed to checkout branch: ${err.message}`);
    }
  }

  async createBranch(name, startPoint = null) {
    try {
      const args = ['-b', name];
      if (startPoint) args.push(startPoint);
      await this.git.checkoutLocalBranch(name);
      return { success: true, name };
    } catch (err) {
      throw new Error(`Failed to create branch: ${err.message}`);
    }
  }

  async merge(branch) {
    try {
      const result = await this.git.merge([branch]);
      return result;
    } catch (err) {
      throw new Error(`Failed to merge: ${err.message}`);
    }
  }

  async deleteBranch(branch, force = false) {
    try {
      const flag = force ? '-D' : '-d';
      await this.git.branch([flag, branch]);
      return { success: true, branch };
    } catch (err) {
      throw new Error(`Failed to delete branch: ${err.message}`);
    }
  }

  async push(remote = 'origin', branch = null) {
    try {
      const args = [remote];
      if (branch) args.push(branch);
      const result = await this.git.push(args);
      return result;
    } catch (err) {
      throw new Error(`Failed to push: ${err.message}`);
    }
  }

  async pull(remote = 'origin', branch = null, options = {}) {
    try {
      const result = await this.git.pull(remote, branch, options);
      return result;
    } catch (err) {
      throw new Error(`Failed to pull: ${err.message}`);
    }
  }

  async fetch(remote = 'origin') {
    try {
      const result = await this.git.fetch(remote);
      return result;
    } catch (err) {
      throw new Error(`Failed to fetch: ${err.message}`);
    }
  }

  async getStatus() {
    try {
      const status = await this.git.status();
      return status;
    } catch (err) {
      throw new Error(`Failed to get status: ${err.message}`);
    }
  }

  async getStashList() {
    try {
      const result = await this.git.stashList();
      return result;
    } catch (err) {
      throw new Error(`Failed to get stash list: ${err.message}`);
    }
  }

  async stash(message = null) {
    try {
      const args = message ? ['push', '-m', message] : [];
      await this.git.stash(args);
      return { success: true };
    } catch (err) {
      throw new Error(`Failed to stash: ${err.message}`);
    }
  }

  async stashPop(index = 0) {
    try {
      await this.git.stash(['pop', `stash@{${index}}`]);
      return { success: true };
    } catch (err) {
      throw new Error(`Failed to pop stash: ${err.message}`);
    }
  }

  async getRemotes() {
    try {
      const remotes = await this.git.getRemotes(true);
      return remotes;
    } catch (err) {
      throw new Error(`Failed to get remotes: ${err.message}`);
    }
  }

  async getFileTree(commitHash = 'HEAD') {
    try {
      const result = await this.git.raw(['ls-tree', '-r', '--name-only', commitHash]);
      return result.trim().split('\n').filter(Boolean);
    } catch (err) {
      throw new Error(`Failed to get file tree: ${err.message}`);
    }
  }

  async getTags() {
    try {
      const result = await this.git.tags();
      return result;
    } catch (err) {
      throw new Error(`Failed to get tags: ${err.message}`);
    }
  }
}

module.exports = GitService;
