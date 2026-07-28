const simpleGit = require('simple-git');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { parseRemoteUrl } = require('./provider-links');

const execFileAsync = promisify(execFile);

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

  async getGraphPage(offset = 0, limit = 500) {
    const safeOffset = Math.max(0, Number.isFinite(Number(offset)) ? Number(offset) : 0);
    const safeLimit = Math.min(1000, Math.max(1, Number.isFinite(Number(limit)) ? Number(limit) : 500));
    try {
      const raw = await this.git.raw([
        'log',
        '--all',
        '--topo-order',
        '--date-order',
        '--parents',
        '-z',
        `--skip=${safeOffset}`,
        `--max-count=${safeLimit + 1}`,
        '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s'
      ]);
      const parsed = raw
        .split('\0')
        .map(record => record.replace(/^[\r\n]+|[\r\n]+$/g, ''))
        .filter(Boolean)
        .map(record => {
          const [hash, parentText = '', authorName = '', authorEmail = '', date = '', ...subjectParts] =
            record.split('\x1f');
          return {
            hash,
            parents: parentText ? parentText.split(/\s+/).filter(Boolean) : [],
            subject: subjectParts.join('\x1f'),
            authorName,
            authorEmail,
            date
          };
        });
      const hasMore = parsed.length > safeLimit;
      const commits = parsed.slice(0, safeLimit);
      return {
        commits,
        refs: await this.getGraphRefs(),
        nextOffset: safeOffset + commits.length,
        hasMore
      };
    } catch (err) {
      if (/does not have any commits|your current branch .* does not have any commits/i.test(err.message)) {
        return { commits: [], refs: [], nextOffset: safeOffset, hasMore: false };
      }
      throw new Error(`Failed to get graph page: ${err.message}`);
    }
  }

  async getGraphRefs() {
    const raw = await this.git.raw([
      'for-each-ref',
      '--format=%(refname)\t%(refname:short)\t%(objectname)\t%(upstream:short)',
      'refs/heads',
      'refs/remotes',
      'refs/tags'
    ]);
    const refs = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => {
        const [fullName, shortName, commit, upstream = ''] = line.split('\t');
        let type = 'branch';
        if (fullName.startsWith('refs/remotes/')) type = 'remote';
        else if (fullName.startsWith('refs/tags/')) type = 'tag';
        return { fullName, shortName, type, commit, upstream };
      })
      .filter(ref => !ref.fullName.endsWith('/HEAD'));

    try {
      const headCommit = (await this.git.revparse(['HEAD'])).trim();
      refs.push({
        fullName: 'HEAD',
        shortName: 'HEAD',
        type: 'head',
        commit: headCommit,
        upstream: ''
      });
    } catch {}
    return refs;
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

  async getBranchComparison(baseBranch, compareBranch, maxCount = 100) {
    try {
      const [diff, log] = await Promise.all([
        this.git.diff([`${baseBranch}...${compareBranch}`]),
        this.getLog(maxCount, `${baseBranch}..${compareBranch}`)
      ]);
      return {
        base: baseBranch,
        compare: compareBranch,
        diff,
        commits: log.all || []
      };
    } catch (err) {
      throw new Error(`Failed to compare branches: ${err.message}`);
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

  async getBranchMetadata() {
    try {
      const [rawBranches, current, remoteDetails] = await Promise.all([
        this.git.raw([
          'for-each-ref',
          '--format=%(refname)\t%(refname:short)\t%(objectname)\t%(upstream:short)\t%(upstream:remotename)',
          'refs/heads',
          'refs/remotes'
        ]),
        this.git.branchLocal().then(result => result.current || ''),
        this.git.getRemotes(true)
      ]);

      const branches = rawBranches
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => {
          const [fullName, name, commit, upstream = '', upstreamRemote = ''] = line.split('\t');
          const kind = fullName.startsWith('refs/remotes/') ? 'remote' : 'local';
          const remote = kind === 'remote'
            ? name.split('/')[0]
            : (upstreamRemote || (upstream ? upstream.split('/')[0] : ''));
          return {
            fullName,
            name,
            kind,
            commit,
            current: kind === 'local' && name === current,
            upstream,
            remote
          };
        })
        .filter(branch => !branch.fullName.endsWith('/HEAD'));

      const remotes = remoteDetails.map(item => {
        const url = item.refs?.fetch || item.refs?.push || '';
        return {
          name: item.name,
          fetchUrl: item.refs?.fetch || '',
          pushUrl: item.refs?.push || '',
          provider: parseRemoteUrl(url)
        };
      });

      const localNames = new Set(
        branches.filter(branch => branch.kind === 'local').map(branch => branch.name)
      );
      let defaultBranch = '';
      try {
        const symbolic = (await this.git.raw([
          'symbolic-ref',
          '--quiet',
          '--short',
          'refs/remotes/origin/HEAD'
        ])).trim();
        defaultBranch = symbolic.replace(/^origin\//, '');
      } catch {}
      if (!defaultBranch) {
        if (localNames.has('main')) defaultBranch = 'main';
        else if (localNames.has('master')) defaultBranch = 'master';
        else defaultBranch = current;
      }

      return { current, defaultBranch, branches, remotes };
    } catch (err) {
      throw new Error(`Failed to get branch metadata: ${err.message}`);
    }
  }

  async checkoutBranch(branch) {
    await this.assertNoPendingOperation();
    await this.assertLocalBranch(branch);
    try {
      await this.git.checkout(branch);
      return { success: true, branch };
    } catch (err) {
      throw new Error(`Failed to checkout branch: ${err.message}`);
    }
  }

  async renameBranch(branch, newName) {
    await this.assertNoPendingOperation();
    await this.assertLocalBranch(branch);
    try {
      await this.git.raw(['check-ref-format', '--branch', newName]);
    } catch {
      throw new Error(`Invalid branch name: ${newName}`);
    }
    try {
      await this.git.raw(['branch', '-m', branch, newName]);
      return { success: true, branch: newName };
    } catch (err) {
      throw new Error(`Failed to rename branch: ${err.message}`);
    }
  }

  async checkoutTrackingBranch(remoteRef) {
    await this.assertNoPendingOperation();
    const separator = remoteRef.indexOf('/');
    if (separator <= 0 || separator >= remoteRef.length - 1) {
      throw new Error(`Invalid remote branch: ${remoteRef}`);
    }
    const localName = remoteRef.slice(separator + 1);
    try {
      await this.git.raw(['show-ref', '--verify', `refs/remotes/${remoteRef}`]);
    } catch {
      throw new Error(`Remote branch not found: ${remoteRef}`);
    }

    let localExists = true;
    try {
      await this.git.raw(['show-ref', '--verify', `refs/heads/${localName}`]);
    } catch {
      localExists = false;
    }

    try {
      if (localExists) {
        await this.git.checkout(localName);
        await this.git.raw(['branch', '--set-upstream-to', remoteRef, localName]);
      } else {
        await this.git.raw(['checkout', '-b', localName, '--track', remoteRef]);
      }
      return { success: true, branch: localName, upstream: remoteRef };
    } catch (err) {
      throw new Error(`Failed to checkout remote branch: ${err.message}`);
    }
  }

  async trackBranch(localBranch, remoteRef) {
    await this.assertNoPendingOperation();
    await this.assertLocalBranch(localBranch);
    await this.assertRemoteBranch(remoteRef);
    try {
      await this.git.raw(['branch', '--set-upstream-to', remoteRef, localBranch]);
      return { success: true, branch: localBranch, upstream: remoteRef };
    } catch (err) {
      throw new Error(`Failed to track remote branch: ${err.message}`);
    }
  }

  async fetchBranch(remote, branch) {
    await this.assertNoPendingOperation();
    await this.assertRemote(remote);
    await this.assertValidBranchName(branch);
    try {
      const result = await this.git.fetch(remote, branch);
      return { success: true, remote, branch, result };
    } catch (err) {
      throw new Error(`Failed to fetch branch: ${err.message}`);
    }
  }

  async deleteRemoteBranch(remote, branch) {
    await this.assertNoPendingOperation();
    await this.assertRemote(remote);
    await this.assertValidBranchName(branch);
    try {
      const result = await this.git.push(['--delete', remote, branch]);
      return { success: true, remote, branch, result };
    } catch (err) {
      throw new Error(`Failed to delete remote branch: ${err.message}`);
    }
  }

  async rebaseOnto(branch) {
    await this.assertNoPendingOperation();
    await this.assertCommitish(branch);
    const status = await this.git.status();
    if (!status.isClean()) {
      throw new Error('Rebase requires a clean working tree');
    }
    try {
      const result = await this.git.rebase([branch]);
      return { success: true, branch, result };
    } catch (err) {
      throw new Error(`Failed to rebase onto ${branch}: ${err.message}`);
    }
  }

  async assertRemote(remote) {
    const remotes = await this.git.getRemotes();
    const exists = remotes.some(item => (
      typeof item === 'string' ? item === remote : item.name === remote
    ));
    if (!exists) throw new Error(`Remote not found: ${remote}`);
  }

  async assertLocalBranch(branch) {
    try {
      await this.git.raw(['show-ref', '--verify', `refs/heads/${branch}`]);
    } catch {
      throw new Error(`Local branch not found: ${branch}`);
    }
  }

  async assertRemoteBranch(remoteRef) {
    try {
      await this.git.raw(['show-ref', '--verify', `refs/remotes/${remoteRef}`]);
    } catch {
      throw new Error(`Remote branch not found: ${remoteRef}`);
    }
  }

  async assertValidBranchName(branch) {
    if (typeof branch !== 'string' || !branch || branch.startsWith('-')) {
      throw new Error(`Invalid branch name: ${branch}`);
    }
    try {
      await this.git.raw(['check-ref-format', '--branch', branch]);
    } catch {
      throw new Error(`Invalid branch name: ${branch}`);
    }
  }

  async assertCommitish(ref) {
    if (typeof ref !== 'string' || !ref || ref.startsWith('-')) {
      throw new Error(`Invalid Git ref: ${ref}`);
    }
    try {
      await this.git.raw(['rev-parse', '--verify', `${ref}^{commit}`]);
    } catch {
      throw new Error(`Git ref not found: ${ref}`);
    }
  }

  async assertNoPendingOperation() {
    const state = await this.getOperationState();
    if (state.type) {
      throw new Error(`Finish or abort the pending ${state.type} before changing branches`);
    }
  }

  async createBranch(name, startPoint = null) {
    await this.assertNoPendingOperation();
    await this.assertValidBranchName(name);
    if (startPoint) await this.assertCommitish(startPoint);
    try {
      if (startPoint) await this.git.checkout(['-b', name, startPoint]);
      else await this.git.checkoutLocalBranch(name);
      return { success: true, name };
    } catch (err) {
      throw new Error(`Failed to create branch: ${err.message}`);
    }
  }

  async merge(branch, strategy = 'ff') {
    await this.assertNoPendingOperation();
    await this.assertCommitish(branch);
    const strategies = {
      ff: '--ff',
      noff: '--no-ff',
      squash: '--squash'
    };
    const flag = strategies[strategy];
    if (!flag) throw new Error(`Invalid merge strategy: ${strategy}`);
    const status = await this.git.status();
    if (!status.isClean()) throw new Error('Merge requires a clean working tree');
    try {
      const result = await this.git.merge([flag, branch]);
      return { success: true, branch, strategy, result };
    } catch (err) {
      throw new Error(`Failed to merge: ${err.message}`);
    }
  }

  async getOperationState() {
    const mergePath = await this.resolveGitPath('MERGE_HEAD');
    const rebaseMergePath = await this.resolveGitPath('rebase-merge');
    const rebaseApplyPath = await this.resolveGitPath('rebase-apply');
    let type = null;
    if (fs.existsSync(mergePath)) type = 'merge';
    else if (fs.existsSync(rebaseMergePath) || fs.existsSync(rebaseApplyPath)) type = 'rebase';

    if (!type) return { type: null, conflicts: [], canContinue: false };
    const raw = await this.git.raw(['diff', '--name-only', '--diff-filter=U', '-z']);
    const conflicts = raw.split('\0').filter(Boolean);
    return { type, conflicts, canContinue: conflicts.length === 0 };
  }

  async readConflict(filePath) {
    const relativePath = this.validateRepositoryPath(filePath);
    const state = await this.getOperationState();
    if (!state.type || !state.conflicts.includes(relativePath)) {
      throw new Error(`File is not conflicted: ${relativePath}`);
    }

    const [base, ours, theirs, result] = await Promise.all([
      this.readStageBlob(1, relativePath),
      this.readStageBlob(2, relativePath),
      this.readStageBlob(3, relativePath),
      fs.promises.readFile(path.resolve(this.repoPath, relativePath)).catch(() => Buffer.alloc(0))
    ]);
    const buffers = [base, ours, theirs, result];
    const binary = buffers.some(buffer => buffer.includes(0));
    const decode = buffer => binary ? '' : buffer.toString('utf8');

    return {
      path: relativePath,
      binary,
      base: decode(base),
      ours: decode(ours),
      theirs: decode(theirs),
      result: decode(result)
    };
  }

  async resolveConflict(filePath, resolution) {
    const relativePath = this.validateRepositoryPath(filePath);
    const state = await this.getOperationState();
    if (!state.type || !state.conflicts.includes(relativePath)) {
      throw new Error(`File is not conflicted: ${relativePath}`);
    }

    const strategy = resolution?.strategy;
    if (strategy === 'manual') {
      if (typeof resolution.content !== 'string') {
        throw new Error('Manual conflict resolution requires text content');
      }
      const conflict = await this.readConflict(relativePath);
      if (conflict.binary) throw new Error('Binary conflicts cannot be edited as text');
      await fs.promises.writeFile(
        path.resolve(this.repoPath, relativePath),
        resolution.content,
        'utf8'
      );
    } else if (strategy === 'ours' || strategy === 'theirs') {
      await this.git.raw(['checkout', `--${strategy}`, '--', relativePath]);
    } else {
      throw new Error(`Invalid conflict strategy: ${strategy}`);
    }

    await this.git.add(['--', relativePath]);
    return { success: true, state: await this.getOperationState() };
  }

  async continueOperation() {
    const state = await this.getOperationState();
    if (!state.type) throw new Error('No merge or rebase is in progress');
    if (state.conflicts.length) throw new Error('Resolve all conflicts before continuing');
    try {
      await execFileAsync(
        'git',
        [state.type, '--continue'],
        {
          cwd: this.repoPath,
          encoding: 'utf8',
          env: {
            ...process.env,
            GIT_EDITOR: 'true',
            GIT_SEQUENCE_EDITOR: 'true'
          }
        }
      );
      return { success: true, state: await this.getOperationState() };
    } catch (err) {
      throw new Error(`Failed to continue ${state.type}: ${err.message}`);
    }
  }

  async abortOperation() {
    const state = await this.getOperationState();
    if (!state.type) throw new Error('No merge or rebase is in progress');
    try {
      await this.git.raw([state.type, '--abort']);
      return { success: true, state: await this.getOperationState() };
    } catch (err) {
      throw new Error(`Failed to abort ${state.type}: ${err.message}`);
    }
  }

  async resolveGitPath(name) {
    const value = (await this.git.raw(['rev-parse', '--git-path', name])).trim();
    return path.isAbsolute(value) ? value : path.resolve(this.repoPath, value);
  }

  validateRepositoryPath(filePath) {
    if (typeof filePath !== 'string' || !filePath || path.isAbsolute(filePath)) {
      throw new Error('Invalid repository path');
    }
    const absolute = path.resolve(this.repoPath, filePath);
    const relative = path.relative(this.repoPath, absolute);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Conflict path is outside the repository');
    }
    return relative.split(path.sep).join('/');
  }

  async readStageBlob(stage, relativePath) {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['show', `:${stage}:${relativePath}`],
        { cwd: this.repoPath, encoding: null, maxBuffer: 50 * 1024 * 1024 }
      );
      return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || '');
    } catch {
      return Buffer.alloc(0);
    }
  }

  async deleteBranch(branch, force = false) {
    await this.assertNoPendingOperation();
    await this.assertLocalBranch(branch);
    const current = (await this.git.branchLocal()).current;
    if (current === branch) throw new Error('The current branch cannot be deleted');
    try {
      const flag = force ? '-D' : '-d';
      await this.git.branch([flag, branch]);
      return { success: true, branch };
    } catch (err) {
      throw new Error(`Failed to delete branch: ${err.message}`);
    }
  }

  async push(remote = 'origin', branch = null, setUpstream = false) {
    await this.assertNoPendingOperation();
    await this.assertRemote(remote);
    if (branch) await this.assertLocalBranch(branch);
    try {
      const args = [];
      if (setUpstream) args.push('--set-upstream');
      args.push(remote);
      if (branch) args.push(branch);
      const result = await this.git.push(args);
      return { success: true, remote, branch, result };
    } catch (err) {
      throw new Error(`Failed to push: ${err.message}`);
    }
  }

  async pull(remote = 'origin', branch = null, options = {}) {
    await this.assertNoPendingOperation();
    await this.assertRemote(remote);
    if (branch) await this.assertValidBranchName(branch);
    try {
      const result = await this.git.pull(remote, branch, options);
      return { success: true, remote, branch, result };
    } catch (err) {
      throw new Error(`Failed to pull: ${err.message}`);
    }
  }

  async fetch(remote = 'origin') {
    try {
      const result = await this.git.fetch(remote);
      return { success: true, remote, result };
    } catch (err) {
      throw new Error(`Failed to fetch: ${err.message}`);
    }
  }

  async getStatus() {
    try {
      const status = await this.git.status();
      return {
        current: status.current,
        tracking: status.tracking,
        detached: status.detached,
        ahead: status.ahead,
        behind: status.behind,
        files: status.files.map(file => ({
          path: file.path,
          index: file.index,
          working_dir: file.working_dir
        })),
        created: [...status.created],
        deleted: [...status.deleted],
        modified: [...status.modified],
        renamed: status.renamed.map(file => ({ from: file.from, to: file.to })),
        conflicted: [...status.conflicted],
        staged: [...status.staged],
        not_added: [...status.not_added],
        isClean: status.isClean()
      };
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
