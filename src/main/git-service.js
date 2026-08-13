const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const RepositorySession = require('./git/repository-session');
const RepositoryHistory = require('./git/repository-history');
const RepositoryWorkingTree = require('./git/repository-working-tree');
const RepositoryOperations = require('./git/repository-operations');
const RepositoryWorktrees = require('./git/repository-worktrees');
const { parseRemoteUrl } = require('./provider-links');

const execFileAsync = promisify(execFile);

class GitService {
  constructor(repoPath, { queue } = {}) {
    this.session = new RepositorySession(repoPath, { queue });
    this.git = this.session.git;
    this.repoPath = this.session.path;
    this.operations = new RepositoryOperations({
      git: this.git,
      repoPath: this.repoPath,
      assertCommitish: ref => this.assertCommitish(ref),
      validateRepositoryPath: (filePath, options) => (
        this.validateRepositoryPath(filePath, options)
      )
    });
    this.workingTree = new RepositoryWorkingTree({
      git: this.git,
      repoPath: this.repoPath,
      assertNoPendingOperation: () => this.assertNoPendingOperation(),
      validateRepositoryPath: (filePath, options) => (
        this.validateRepositoryPath(filePath, options)
      ),
      getSubmodules: () => this.getSubmodules()
    });
    this.history = new RepositoryHistory({
      git: this.git,
      assertSafeRef: ref => this.assertSafeRef(ref),
      assertCommitish: ref => this.assertCommitish(ref),
      validateRepositoryPath: filePath => this.validateRepositoryPath(filePath)
    });
    this.worktrees = new RepositoryWorktrees({
      git: this.git,
      repoPath: this.repoPath,
      readStatus: async worktreePath => this.worktrees.parseStatus(await this.git.raw([
        '-C', worktreePath, 'status', '--porcelain=v2', '--branch', '--untracked-files=normal'
      ])),
      assertNoPendingOperation: () => this.assertNoPendingOperation(),
      assertValidBranchName: branch => this.assertValidBranchName(branch),
      assertCommitish: ref => this.assertCommitish(ref)
    });
  }

  runExclusive(fn) {
    return this.session.runExclusive(fn);
  }

  async getLog(maxCount = 100, branch = null) {
    return this.history.getLog(maxCount, branch);
  }

  async getGraphPage(offset = 0, limit = 500) {
    return this.history.getGraphPage(offset, limit);
  }

  async getGraphRefs() {
    return this.history.getGraphRefs();
  }

  async getDiff(commitHash = null, file = null) {
    return this.history.getDiff(commitHash, file);
  }

  async getCommitDiff(hash, file = null) {
    return this.history.getCommitDiff(hash, file);
  }

  async hasParent(commitHash) {
    return this.history.hasParent(commitHash);
  }

  async getBranchComparison(baseBranch, compareBranch, maxCount = 100) {
    return this.history.getBranchComparison(baseBranch, compareBranch, maxCount);
  }

  async compareCommits(hashA, hashB) {
    return this.history.compareCommits(hashA, hashB);
  }

  parseNameStatus(raw) {
    return this.history.parseNameStatus(raw);
  }

  async getCommitFileDiff(hashA, hashB, filePath) {
    return this.history.getCommitFileDiff(hashA, hashB, filePath);
  }

  async getCommitDetail(hash) {
    return this.history.getCommitDetail(hash);
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
      throw new Error(`Failed to get branches: ${err.message}`, { cause: err });
    }
  }

  async getBranchMetadata() {
    try {
      const [rawBranches, current, remoteDetails] = await Promise.all([
        this.git.raw([
          'for-each-ref',
          '--format=%(refname)\t%(refname:short)\t%(objectname)\t%(upstream:short)\t%(upstream:remotename)\t%(upstream:track,nobracket)',
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
          const [
            fullName,
            name,
            commit,
            upstream = '',
            upstreamRemote = '',
            upstreamTrack = ''
          ] = line.split('\t');
          const kind = fullName.startsWith('refs/remotes/') ? 'remote' : 'local';
          const remote = kind === 'remote'
            ? name.split('/')[0]
            : (upstreamRemote || (upstream ? upstream.split('/')[0] : ''));
          const ahead = Number(upstreamTrack.match(/\bahead\s+(\d+)/)?.[1] || 0);
          const behind = Number(upstreamTrack.match(/\bbehind\s+(\d+)/)?.[1] || 0);
          return {
            fullName,
            name,
            kind,
            commit,
            current: kind === 'local' && name === current,
            upstream,
            remote,
            ahead,
            behind
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
      } catch { /* remote HEAD may be missing */ }
      if (!defaultBranch) {
        if (localNames.has('main')) defaultBranch = 'main';
        else if (localNames.has('master')) defaultBranch = 'master';
        else defaultBranch = current;
      }

      return { current, defaultBranch, branches, remotes };
    } catch (err) {
      throw new Error(`Failed to get branch metadata: ${err.message}`, { cause: err });
    }
  }

  async checkoutBranch(branch) {
    await this.assertNoPendingOperation();
    await this.assertLocalBranch(branch);
    try {
      await this.git.checkout(branch);
      return { success: true, branch };
    } catch (err) {
      throw new Error(`Failed to checkout branch: ${err.message}`, { cause: err });
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
      throw new Error(`Failed to rename branch: ${err.message}`, { cause: err });
    }
  }

  async checkoutTrackingBranch(remoteRef) {
    await this.assertNoPendingOperation();
    const separator = remoteRef.indexOf('/');
    if (separator <= 0 || separator >= remoteRef.length - 1) {
      throw new Error(`Invalid remote branch: ${remoteRef}`);
    }
    const localName = remoteRef.slice(separator + 1);
    if (!localName || localName.startsWith('-')) {
      throw new Error(`Invalid remote branch: ${remoteRef}`);
    }
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
      throw new Error(`Failed to checkout remote branch: ${err.message}`, { cause: err });
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
      throw new Error(`Failed to track remote branch: ${err.message}`, { cause: err });
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
      throw new Error(`Failed to fetch branch: ${err.message}`, { cause: err });
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
      throw new Error(`Failed to delete remote branch: ${err.message}`, { cause: err });
    }
  }

  async rebaseOnto(branch) {
    return this.operations.rebaseOnto(branch);
  }

  validateCommitHashes(hashes) {
    return this.operations.validateCommitHashes(hashes);
  }

  async getCommitActionMetadata(hashes) {
    return this.operations.getCommitActionMetadata(hashes);
  }

  sortCommitsParentFirst(commits) {
    return this.operations.sortCommitsParentFirst(commits);
  }

  async isAncestor(ancestor, descendant) {
    return this.operations.isAncestor(ancestor, descendant);
  }

  async getCommitFiles(commits) {
    return this.operations.getCommitFiles(commits);
  }

  async previewCommitAction(action, hashes) {
    return this.operations.previewCommitAction(action, hashes);
  }

  async rebaseOntoCommit(hash) {
    return this.operations.rebaseOntoCommit(hash);
  }

  async cherryPickCommits(hashes) {
    return this.operations.cherryPickCommits(hashes);
  }

  async checkoutPullRequestSource(options) {
    await this.assertNoPendingOperation();
    const provider = options?.provider;
    if (!['github', 'gitlab'].includes(provider)) {
      throw new Error('Unsupported pull request provider');
    }
    const remote = options?.remote;
    await this.assertRemote(remote);
    const source = options?.source;
    await this.assertValidBranchName(source);
    const localBranch = options?.localBranch || source;
    await this.assertValidBranchName(localBranch);
    const number = Number(options?.number);
    if (!Number.isSafeInteger(number) || number <= 0) {
      throw new Error('Invalid pull request ID');
    }
    const headSha = options?.headSha || '';
    if (headSha && !/^[a-f0-9]{7,64}$/i.test(headSha)) {
      throw new Error('Invalid pull request head SHA');
    }
    const status = await this.git.status();
    const remoteRef = `${remote}/${source}`;
    let tracksRemote = true;
    try {
      await this.assertRemoteBranch(remoteRef);
    } catch {
      tracksRemote = false;
    }
    let localExists = true;
    try {
      await this.assertLocalBranch(localBranch);
    } catch {
      localExists = false;
    }
    const allowed = status.isClean() && (!localExists || tracksRemote);
    const preview = {
      provider,
      source,
      localBranch,
      remote,
      headSha,
      tracksRemote,
      localExists,
      clean: status.isClean(),
      allowed,
      reason: !status.isClean()
        ? 'Checkout requires a clean working tree'
        : (localExists && !tracksRemote
          ? `Local branch already exists: ${localBranch}`
          : '')
    };
    if (!options.confirmed || !allowed) return preview;
    if (tracksRemote) {
      const result = await this.checkoutTrackingBranch(remoteRef);
      return { ...preview, success: true, branch: result.branch };
    }
    const providerRef = provider === 'github'
      ? `refs/pull/${number}/head`
      : `refs/merge-requests/${number}/head`;
    await this.git.raw(['fetch', remote, providerRef]);
    const fetchedHead = (await this.git.revparse(['FETCH_HEAD'])).trim();
    if (headSha && fetchedHead !== headSha) {
      throw new Error('Fetched pull request head does not match the provider');
    }
    await this.git.raw(['checkout', '-b', localBranch, 'FETCH_HEAD']);
    return { ...preview, success: true, branch: localBranch };
  }

  async assertRemote(remote) {
    const remotes = await this.git.getRemotes();
    const exists = remotes.some(item => (
      typeof item === 'string' ? item === remote : item.name === remote
    ));
    if (!exists) throw new Error(`Remote not found: ${remote}`);
  }

  async assertLocalBranch(branch) {
    if (typeof branch !== 'string' || !branch || branch.startsWith('-')) {
      throw new Error(`Invalid local branch name: ${branch}`);
    }
    try {
      await this.git.raw(['show-ref', '--verify', `refs/heads/${branch}`]);
    } catch {
      throw new Error(`Local branch not found: ${branch}`);
    }
  }

  async assertRemoteBranch(remoteRef) {
    if (typeof remoteRef !== 'string' || !remoteRef || remoteRef.startsWith('-')) {
      throw new Error(`Invalid remote branch: ${remoteRef}`);
    }
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

  assertSafeRef(ref) {
    if (
      typeof ref !== 'string' ||
      !ref.trim() ||
      ref !== ref.trim() ||
      ref.startsWith('-') ||
      /[\0\r\n]/.test(ref)
    ) {
      throw new Error(`Invalid Git ref: ${ref}`);
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
    return this.operations.assertNoPendingOperation();
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
      throw new Error(`Failed to create branch: ${err.message}`, { cause: err });
    }
  }

  async merge(branch, strategy = 'ff') {
    return this.operations.merge(branch, strategy);
  }

  async mergeBlockingFiles(branch, status) {
    return this.operations.mergeBlockingFiles(branch, status);
  }

  async previewMerge(branch) {
    return this.operations.previewMerge(branch);
  }

  parseConflictBlocks(content) {
    return this.operations.parseConflictBlocks(content);
  }

  async getOperationState() {
    return this.operations.getOperationState();
  }

  async readConflict(filePath) {
    return this.operations.readConflict(filePath);
  }

  async resolveConflict(filePath, resolution) {
    return this.operations.resolveConflict(filePath, resolution);
  }

  async continueOperation() {
    return this.operations.continueOperation();
  }

  async abortOperation() {
    return this.operations.abortOperation();
  }

  async skipOperation() {
    return this.operations.skipOperation();
  }

  async resolveGitPath(name) {
    return this.operations.resolveGitPath(name);
  }

  validateRepositoryPath(filePath, options = {}) {
    const rejectSymlinks = options.rejectSymlinks !== false;
    if (typeof filePath !== 'string' || !filePath || path.isAbsolute(filePath)) {
      throw new Error('Invalid repository path');
    }
    const repoRoot = path.resolve(this.repoPath);
    const absolute = path.resolve(repoRoot, filePath);
    const relative = path.relative(repoRoot, absolute);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Conflict path is outside the repository');
    }
    if (rejectSymlinks) {
      let current = repoRoot;
      for (const part of relative.split(path.sep)) {
        current = path.join(current, part);
        try {
          if (fs.lstatSync(current).isSymbolicLink()) {
            throw new Error('Repository paths cannot traverse symbolic links');
          }
        } catch (error) {
          if (error.code === 'ENOENT') break;
          if (error.message === 'Repository paths cannot traverse symbolic links') throw error;
          throw new Error('Invalid repository path', { cause: error });
        }
      }
    }
    return relative.split(path.sep).join('/');
  }

  async readStageBlob(stage, relativePath) {
    return this.operations.readStageBlob(stage, relativePath);
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
      throw new Error(`Failed to delete branch: ${err.message}`, { cause: err });
    }
  }

  async deleteBranches(branches, force = false) {
    await this.assertNoPendingOperation();
    const current = (await this.git.branchLocal()).current;
    const results = [];
    for (const branch of branches) {
      if (branch === current) {
        results.push({ branch, success: false, error: 'Cannot delete the current branch' });
        continue;
      }
      try {
        await this.assertLocalBranch(branch);
        await this.git.branch([force ? '-D' : '-d', branch]);
        results.push({ branch, success: true });
      } catch (err) {
        results.push({ branch, success: false, error: err.message });
      }
    }
    return { results };
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
      throw new Error(`Failed to push: ${err.message}`, { cause: err });
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
      throw new Error(`Failed to pull: ${err.message}`, { cause: err });
    }
  }

  async fetch(remote = 'origin') {
    await this.assertRemote(remote);
    try {
      const result = await this.git.fetch(remote);
      return { success: true, remote, result };
    } catch (err) {
      throw new Error(`Failed to fetch: ${err.message}`, { cause: err });
    }
  }

  async getStatus() {
    return this.workingTree.getStatus();
  }

  async getWorkingTree() {
    return this.workingTree.getWorkingTree();
  }

  async assertWorkingTreeSnapshot(snapshotId) {
    return this.workingTree.assertWorkingTreeSnapshot(snapshotId);
  }

  validatePathList(paths) {
    return this.workingTree.validatePathList(paths);
  }

  async stagePaths(snapshotId, paths) {
    return this.workingTree.stagePaths(snapshotId, paths);
  }

  async unstagePaths(snapshotId, paths) {
    return this.workingTree.unstagePaths(snapshotId, paths);
  }

  async discardPaths(snapshotId, paths) {
    return this.workingTree.discardPaths(snapshotId, paths);
  }

  async getWorkingDiff(filePath, staged = false) {
    return this.workingTree.getWorkingDiff(filePath, staged);
  }

  async getStagedDiff(maxBytes = 24576) {
    const raw = await this.git.raw(['diff', '--cached', '--no-ext-diff']);
    const cap = Math.min(1024 * 1024, Math.max(1024, Number(maxBytes) || 24576));
    return raw.length > cap ? `${raw.slice(0, cap)}\n... diff truncated ...` : raw;
  }

  async getParsedWorkingDiff(filePath, staged = false) {
    return this.workingTree.getParsedWorkingDiff(filePath, staged);
  }

  parseWorkingDiff(relativePath, staged, patch) {
    return this.workingTree.parseWorkingDiff(relativePath, staged, patch);
  }

  validateHunkIds(hunkIds) {
    return this.workingTree.validateHunkIds(hunkIds);
  }

  async stageHunks(snapshotId, filePath, hunkIds) {
    return this.workingTree.stageHunks(snapshotId, filePath, hunkIds);
  }

  async unstageHunks(snapshotId, filePath, hunkIds) {
    return this.workingTree.unstageHunks(snapshotId, filePath, hunkIds);
  }

  async applyWorkingHunks(snapshotId, filePath, hunkIds, reverse) {
    return this.workingTree.applyWorkingHunks(snapshotId, filePath, hunkIds, reverse);
  }

  runGitWithInput(args, input) {
    return this.workingTree.runGitWithInput(args, input);
  }

  async getConfigValue(key, scope = null) {
    const args = ['config'];
    if (scope) args.push(`--${scope}`);
    args.push('--get', key);
    try {
      return (await this.git.raw(args)).trim();
    } catch {
      return '';
    }
  }

  async getIdentity() {
    const [localName, localEmail, globalName, globalEmail, signingKey, signingFormat, gpgSign] =
      await Promise.all([
        this.getConfigValue('user.name', 'local'),
        this.getConfigValue('user.email', 'local'),
        this.getConfigValue('user.name', 'global'),
        this.getConfigValue('user.email', 'global'),
        this.getConfigValue('user.signingKey'),
        this.getConfigValue('gpg.format'),
        this.getConfigValue('commit.gpgSign')
      ]);
    const name = localName || globalName;
    const email = localEmail || globalEmail;
    const format = signingFormat || 'openpgp';
    return {
      name,
      email,
      nameSource: localName ? 'local' : (globalName ? 'global' : null),
      emailSource: localEmail ? 'local' : (globalEmail ? 'global' : null),
      configured: Boolean(name && email),
      signing: {
        enabledByDefault: /^(true|yes|on|1)$/i.test(gpgSign),
        format,
        key: signingKey,
        available: Boolean(signingKey && ['openpgp', 'ssh', 'x509'].includes(format))
      }
    };
  }

  validateIdentityValue(value, label, maxLength) {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.length > maxLength ||
      /[\r\n\0]/.test(value)
    ) {
      throw new Error(`Invalid Git ${label}`);
    }
    return value.trim();
  }

  validateEmail(email) {
    const safeEmail = this.validateIdentityValue(email, 'email', 254);
    if (!/^[^\s<>@]+@[^\s<>@]+$/.test(safeEmail)) {
      throw new Error('Invalid Git email');
    }
    return safeEmail;
  }

  async setIdentity(options) {
    const name = this.validateIdentityValue(options?.name, 'name', 200);
    const email = this.validateEmail(options?.email);
    const scope = options?.scope || 'local';
    if (!['local', 'global'].includes(scope)) {
      throw new Error('Invalid Git identity scope');
    }
    await this.git.raw(['config', `--${scope}`, 'user.name', name]);
    await this.git.raw(['config', `--${scope}`, 'user.email', email]);
    return { success: true, identity: await this.getIdentity() };
  }

  async commitChanges(options = {}) {
    await this.assertNoPendingOperation();
    const summary = this.validateIdentityValue(options.summary, 'commit summary', 200);
    const body = typeof options.body === 'string' ? options.body.trim() : '';
    if (body.length > 100000 || /\0/.test(body)) {
      throw new Error('Invalid Git commit body');
    }
    const amend = Boolean(options.amend);
    const identity = await this.getIdentity();
    if (!identity.configured) {
      throw new Error('Git identity is missing; configure user.name and user.email');
    }
    if (!amend) {
      const stagedPaths = await this.git.raw(['diff', '--cached', '--name-only', '-z']);
      if (!stagedPaths) throw new Error('There are no staged changes to commit');
    } else {
      await this.assertCommitish('HEAD');
    }

    const args = ['commit', '-m', summary];
    if (body) args.push('-m', body);
    if (amend) args.push('--amend');
    if (options.signoff) args.push('--signoff');
    if (options.signing === true) {
      if (!identity.signing.available) {
        throw new Error('Commit signing requires a configured signing key (user.signingKey)');
      }
      args.push('-S');
    } else if (options.signing === false) {
      args.push('--no-gpg-sign');
    }
    if (options.authorOverride) {
      const authorName = this.validateIdentityValue(
        options.authorOverride.name,
        'author name',
        200
      );
      const authorEmail = this.validateEmail(options.authorOverride.email);
      args.push(`--author=${authorName} <${authorEmail}>`);
    }

    try {
      await this.git.raw(args);
      const hash = (await this.git.revparse(['HEAD'])).trim();
      return {
        success: true,
        hash,
        snapshot: await this.getWorkingTree()
      };
    } catch (error) {
      throw new Error(`Commit failed: ${error.message}`, { cause: error });
    }
  }

  async getStashList() {
    try {
      const result = await this.git.stashList();
      return result;
    } catch (err) {
      throw new Error(`Failed to get stash list: ${err.message}`, { cause: err });
    }
  }

  async stash(message = null) {
    try {
      const args = ['push', '-u'];
      if (message) args.push('-m', message);
      await this.git.stash(args);
      return { success: true };
    } catch (err) {
      throw new Error(`Failed to stash: ${err.message}`, { cause: err });
    }
  }

  async stashPop(index = 0) {
    const safeIndex = this.safeStashIndex(index);
    try {
      await this.git.stash(['pop', `stash@{${safeIndex}}`]);
      return { success: true };
    } catch (err) {
      throw new Error(`Failed to pop stash: ${err.message}`, { cause: err });
    }
  }

  async stashApply(index = 0) {
    const safeIndex = this.safeStashIndex(index);
    try {
      await this.git.stash(['apply', `stash@{${safeIndex}}`]);
      return { success: true };
    } catch (err) {
      throw new Error(`Failed to apply stash: ${err.message}`, { cause: err });
    }
  }

  async stashDrop(index = 0) {
    const safeIndex = this.safeStashIndex(index);
    try {
      await this.git.stash(['drop', `stash@{${safeIndex}}`]);
      return { success: true };
    } catch (err) {
      throw new Error(`Failed to drop stash: ${err.message}`, { cause: err });
    }
  }

  safeStashIndex(index) {
    const numeric = Number(index);
    if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < 0) {
      throw new Error('Invalid stash index');
    }
    return numeric;
  }

  async getRemotes() {
    try {
      const remotes = await this.git.getRemotes(true);
      return remotes;
    } catch (err) {
      throw new Error(`Failed to get remotes: ${err.message}`, { cause: err });
    }
  }

  async getReflog(maxCount = 200) {
    const safeMax = Math.min(500, Math.max(1, Number(maxCount) || 200));
    try {
      const raw = await this.git.raw([
        'reflog',
        '--date=iso',
        `--max-count=${safeMax}`,
        '--format=%H%x1f%gd%x1f%gs%x1f%cd'
      ]);
      return raw.split(/\r?\n/).filter(Boolean).map(line => {
        const [hash, ref, message, date] = line.split('\x1f');
        return {
          hash: hash || '',
          ref: ref || '',
          message: message || '',
          date: date || ''
        };
      });
    } catch (err) {
      throw new Error(`Failed to get reflog: ${err.message}`, { cause: err });
    }
  }

  async getWorktrees() {
    return this.worktrees.list();
  }

  async createWorktree(directory, branch) {
    const result = await this.worktrees.create({ directory, branch, baseRef: 'HEAD' });
    return { success: true, path: result.path, branch: result.branch };
  }

  async createManagedWorktree(options) {
    return this.worktrees.create(options || {});
  }

  async removeWorktree(directory) {
    return this.worktrees.remove(directory);
  }

  async lockWorktree(directory, reason = '') {
    return this.worktrees.lock(directory, reason);
  }

  async unlockWorktree(directory) {
    return this.worktrees.unlock(directory);
  }

  async getSubmodules() {
    try {
      const raw = await this.git.raw(['submodule', 'status']);
      return raw.split(/\r?\n/).filter(Boolean).map(line => {
        const status = line[0] || ' ';
        const rest = line.slice(1).trim();
        const [hash, pathPart] = rest.split(/\s+/, 2);
        const path = pathPart || '';
        return { status, hash: hash || '', path };
      });
    } catch (error) {
      if (/no submodule mapping found/i.test(error.message)) return [];
      throw new Error(`Failed to get submodules: ${error.message}`, { cause: error });
    }
  }

  async initSubmodules() {
    await this.assertNoPendingOperation();
    try {
      await execFileAsync(
        'git',
        ['submodule', 'update', '--init', '--recursive'],
        {
          cwd: this.repoPath,
          encoding: 'utf8',
          env: { ...process.env, GIT_ALLOW_PROTOCOL: 'file' },
          maxBuffer: 50 * 1024 * 1024
        }
      );
      return { success: true };
    } catch (error) {
      throw new Error(`Failed to initialize submodules: ${error.message}`, { cause: error });
    }
  }

  async updateSubmodules() {
    await this.assertNoPendingOperation();
    try {
      await execFileAsync(
        'git',
        ['submodule', 'update', '--recursive'],
        {
          cwd: this.repoPath,
          encoding: 'utf8',
          env: { ...process.env, GIT_ALLOW_PROTOCOL: 'file' },
          maxBuffer: 50 * 1024 * 1024
        }
      );
      return { success: true };
    } catch (error) {
      throw new Error(`Failed to update submodules: ${error.message}`, { cause: error });
    }
  }

  async assertValidRemoteName(name) {
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name.startsWith('-') ||
      name.length > 200 ||
      /[\s\0\r\n]/.test(name)
    ) {
      throw new Error('Invalid remote name');
    }
    try {
      await this.git.raw(['check-ref-format', `refs/remotes/${name}`]);
    } catch {
      throw new Error(`Invalid remote name: ${name}`);
    }
  }

  validateRemoteUrl(url) {
    if (
      typeof url !== 'string' ||
      !url.trim() ||
      url.length > 4096 ||
      url.trim().startsWith('-') ||
      /[\0\r\n]/.test(url)
    ) {
      throw new Error('Invalid remote URL');
    }
    return url.trim();
  }

  async addRemote(name, url) {
    await this.assertValidRemoteName(name);
    const safeUrl = this.validateRemoteUrl(url);
    try {
      await this.git.raw(['remote', 'add', name, safeUrl]);
      return { success: true, name, url: safeUrl };
    } catch (error) {
      throw new Error(`Failed to add remote: ${error.message}`, { cause: error });
    }
  }

  async renameRemote(name, newName) {
    await this.assertRemote(name);
    await this.assertValidRemoteName(newName);
    try {
      await this.git.raw(['remote', 'rename', name, newName]);
      return { success: true, name: newName };
    } catch (error) {
      throw new Error(`Failed to rename remote: ${error.message}`, { cause: error });
    }
  }

  async setRemoteUrl(name, url) {
    await this.assertRemote(name);
    const safeUrl = this.validateRemoteUrl(url);
    try {
      await this.git.raw(['remote', 'set-url', name, safeUrl]);
      return { success: true, name, url: safeUrl };
    } catch (error) {
      throw new Error(`Failed to update remote URL: ${error.message}`, { cause: error });
    }
  }

  async removeRemote(name) {
    await this.assertRemote(name);
    try {
      await this.git.raw(['remote', 'remove', name]);
      return { success: true, name };
    } catch (error) {
      throw new Error(`Failed to remove remote: ${error.message}`, { cause: error });
    }
  }

  async getFileTree(commitHash = 'HEAD') {
    this.assertSafeRef(commitHash);
    try {
      const result = await this.git.raw(['ls-tree', '-r', '--name-only', commitHash]);
      return result.trim().split('\n').filter(Boolean);
    } catch (err) {
      throw new Error(`Failed to get file tree: ${err.message}`, { cause: err });
    }
  }

  async restoreFileFromCommit(commitHash, filePath) {
    await this.assertNoPendingOperation();
    await this.assertCommitish(commitHash);
    const relativePath = this.validateRepositoryPath(filePath);
    try {
      await this.git.raw(['restore', '--source', commitHash, '--worktree', '--', relativePath]);
      return { success: true, path: relativePath };
    } catch (error) {
      throw new Error(`Failed to restore file: ${error.message}`, { cause: error });
    }
  }

  async getTags() {
    try {
      const result = await this.git.tags();
      return result;
    } catch (err) {
      throw new Error(`Failed to get tags: ${err.message}`, { cause: err });
    }
  }

  validateTagName(name) {
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 255 ||
      name.startsWith('-') ||
      /[\0-\x20\x7f~^:?*[\]\\]/.test(name) ||
      name.includes('..') ||
      name.includes('@{') ||
      name.endsWith('.') ||
      name.endsWith('/') ||
      name.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.lock'))
    ) {
      throw new Error('Invalid tag name');
    }
    return name.trim();
  }

  async assertTagExists(name) {
    const safeName = this.validateTagName(name);
    try {
      await this.git.raw(['check-ref-format', `refs/tags/${safeName}`]);
    } catch {
      throw new Error(`Invalid tag name: ${safeName}`);
    }
    try {
      await this.git.raw(['show-ref', '--verify', `refs/tags/${safeName}`]);
    } catch {
      throw new Error(`Tag not found: ${safeName}`);
    }
    return safeName;
  }

  async deleteTag(name) {
    const safeName = await this.assertTagExists(name);
    try {
      await this.git.raw(['tag', '-d', safeName]);
      return { success: true, name: safeName };
    } catch (error) {
      throw new Error(`Failed to delete tag: ${error.message}`, { cause: error });
    }
  }

  async pushTags(remote) {
    await this.assertRemote(remote);
    try {
      await this.git.push([remote, '--tags']);
      return { success: true, remote };
    } catch (error) {
      throw new Error(`Failed to push tags: ${error.message}`, { cause: error });
    }
  }

  async deleteRemoteTag(remote, name) {
    await this.assertRemote(remote);
    const safeName = await this.assertTagExists(name);
    try {
      await this.git.push([remote, `:refs/tags/${safeName}`]);
      return { success: true, remote, name: safeName };
    } catch (error) {
      throw new Error(`Failed to delete remote tag: ${error.message}`, { cause: error });
    }
  }

  async getTagsAtCommit(commitHash) {
    this.assertSafeRef(commitHash);
    try {
      const result = await this.git.raw(['tag', '--points-at', commitHash]);
      return result.split(/\r?\n/).filter(Boolean);
    } catch (error) {
      throw new Error(`Failed to get tags: ${error.message}`, { cause: error });
    }
  }

  async createTag(name, commitHash, message = '') {
    await this.assertNoPendingOperation();
    await this.assertCommitish(commitHash);
    const safeName = this.validateTagName(name);
    try {
      await this.git.raw(['check-ref-format', `refs/tags/${safeName}`]);
    } catch {
      throw new Error(`Invalid tag name: ${safeName}`);
    }
    try {
      await this.git.raw(['show-ref', '--verify', `refs/tags/${safeName}`]);
      throw new Error(`Tag already exists: ${safeName}`);
    } catch (error) {
      if (/Tag already exists/.test(error.message)) throw error;
    }
    if (typeof message !== 'string' || message.length > 10000 || message.includes('\0')) {
      throw new Error('Invalid tag annotation');
    }
    const annotation = message.trim();
    const args = annotation
      ? ['tag', '-a', safeName, commitHash, '-m', annotation]
      : ['tag', safeName, commitHash];
    try {
      await this.git.raw(args);
      return {
        success: true,
        name: safeName,
        hash: commitHash,
        annotated: Boolean(annotation)
      };
    } catch (error) {
      throw new Error(`Failed to create tag: ${error.message}`, { cause: error });
    }
  }
}

for (const methodName of Object.getOwnPropertyNames(GitService.prototype)) {
  if (methodName === 'constructor' || methodName === 'runExclusive') continue;
  const original = GitService.prototype[methodName];
  if (typeof original !== 'function' || original.constructor.name !== 'AsyncFunction') continue;
  GitService.prototype[methodName] = function (...args) {
    if (this.session.isCurrent()) return original.apply(this, args);
    return this.runExclusive(() => original.apply(this, args));
  };
}

module.exports = GitService;
