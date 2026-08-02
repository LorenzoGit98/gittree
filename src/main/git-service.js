const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');
const RepositorySession = require('./git/repository-session');
const { parseRemoteUrl } = require('./provider-links');
const {
  MAX_CONFLICT_RESULT_BYTES,
  conflictSnapshot,
  hasUnresolvedMarkers,
  parseConflictBlocks
} = require('./conflict-model');

const execFileAsync = promisify(execFile);

class GitService {
  constructor(repoPath) {
    this.session = new RepositorySession(repoPath);
    this.git = this.session.git;
    this.repoPath = this.session.path;
  }

  runExclusive(fn) {
    return this.session.runExclusive(fn);
  }

  async getLog(maxCount = 100, branch = null) {
    const safeMaxCount = Math.min(1000, Math.max(1, Number(maxCount) || 100));
    if (branch) this.assertSafeRef(branch);
    try {
      const options = { maxCount: safeMaxCount, '--date': 'iso' };
      if (branch) options[branch] = null;
      const log = await this.git.log(options);
      return log;
    } catch (err) {
      throw new Error(`Failed to get log: ${err.message}`, { cause: err });
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
      throw new Error(`Failed to get graph page: ${err.message}`, { cause: err });
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
    } catch { /* HEAD may be unborn */ }
    return refs;
  }

  async getDiff(commitHash = null, file = null) {
    if (!commitHash) {
      const relativeFile = file ? this.validateRepositoryPath(file) : null;
      try {
        const options = ['--no-ext-diff'];
        if (relativeFile) options.push('--', relativeFile);
        return await this.git.diff(options);
      } catch (err) {
        throw new Error(`Failed to get diff: ${err.message}`, { cause: err });
      }
    }
    return this.getCommitDiff(commitHash, file);
  }

  async getCommitDiff(hash, file = null) {
    this.assertSafeRef(hash);
    const relativeFile = file ? this.validateRepositoryPath(file) : null;
    const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
    try {
      const options = ['--no-ext-diff'];
      if (await this.hasParent(hash)) options.push(`${hash}^..${hash}`);
      else options.push(`${emptyTree}..${hash}`);
      if (relativeFile) options.push('--', relativeFile);
      return await this.git.diff(options);
    } catch (err) {
      throw new Error(`Failed to get diff: ${err.message}`, { cause: err });
    }
  }

  async hasParent(commitHash) {
    try {
      const parents = await this.git.raw(['rev-list', '--parents', '-n', '1', commitHash]);
      return parents.split(/\s+/).filter(Boolean).length > 1;
    } catch {
      return true;
    }
  }

  async getBranchComparison(baseBranch, compareBranch, maxCount = 100) {
    this.assertSafeRef(baseBranch);
    this.assertSafeRef(compareBranch);
    try {
      const [diff, log] = await Promise.all([
        this.git.diff(['--no-ext-diff', `${baseBranch}...${compareBranch}`]),
        this.getLog(maxCount, `${baseBranch}..${compareBranch}`)
      ]);
      return {
        base: baseBranch,
        compare: compareBranch,
        diff,
        commits: log.all || []
      };
    } catch (err) {
      throw new Error(`Failed to compare branches: ${err.message}`, { cause: err });
    }
  }

  async compareCommits(hashA, hashB) {
    await this.assertCommitish(hashA);
    await this.assertCommitish(hashB);
    try {
      const nameStatus = await this.git.raw([
        'diff', '--no-ext-diff', '--name-status', '-z', `${hashA}..${hashB}`
      ]);
      const files = this.parseNameStatus(nameStatus);
      const diff = await this.git.diff(['--no-ext-diff', `${hashA}..${hashB}`]);
      return { base: hashA, compare: hashB, files, diff };
    } catch (err) {
      throw new Error(`Failed to compare commits: ${err.message}`, { cause: err });
    }
  }

  parseNameStatus(raw) {
    const parts = raw.split('\0').filter(Boolean);
    const files = [];
    let index = 0;
    while (index < parts.length) {
      const status = parts[index];
      if (status.startsWith('R') || status.startsWith('C')) {
        const oldPath = parts[index + 1] || '';
        const newPath = parts[index + 2] || '';
        files.push({ path: newPath, oldPath, status: status[0] });
        index += 3;
      } else {
        files.push({ path: parts[index + 1] || '', oldPath: null, status: status[0] });
        index += 2;
      }
    }
    return files;
  }

  async getCommitFileDiff(hashA, hashB, filePath) {
    await this.assertCommitish(hashA);
    await this.assertCommitish(hashB);
    const relativePath = this.validateRepositoryPath(filePath);
    try {
      const patch = await this.git.raw([
        'diff', '--no-ext-diff', '--unified=3', `${hashA}..${hashB}`, '--', relativePath
      ]);
      return this.parseWorkingDiff(relativePath, false, patch);
    } catch (err) {
      throw new Error(`Failed to get commit file diff: ${err.message}`, { cause: err });
    }
  }

  async getCommitDetail(hash) {
    this.assertSafeRef(hash);
    try {
      const log = await this.git.log({ maxCount: 1, '--date': 'iso', [hash]: null });
      if (!log.latest) return null;
      const diff = await this.getCommitDiff(hash);
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
      throw new Error(`Failed to get commit detail: ${err.message}`, { cause: err });
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
      throw new Error(`Failed to rebase onto ${branch}: ${err.message}`, { cause: err });
    }
  }

  validateCommitHashes(hashes) {
    if (!Array.isArray(hashes) || hashes.length === 0 || hashes.length > 500) {
      throw new Error('Select between 1 and 500 commits');
    }
    const unique = [...new Set(hashes)];
    if (unique.some(hash => typeof hash !== 'string' || !/^[a-f0-9]{7,64}$/i.test(hash))) {
      throw new Error('Invalid commit hash');
    }
    return unique;
  }

  async getCommitActionMetadata(hashes) {
    const metadata = [];
    for (const hash of this.validateCommitHashes(hashes)) {
      await this.assertCommitish(hash);
      const raw = await this.git.raw([
        'show',
        '-s',
        '--format=%H%x1f%P%x1f%ct%x1f%s',
        hash
      ]);
      const [fullHash, parentText = '', timestamp = '0', ...subject] =
        raw.trim().split('\x1f');
      metadata.push({
        hash: fullHash,
        parents: parentText ? parentText.split(/\s+/) : [],
        timestamp: Number(timestamp) || 0,
        subject: subject.join('\x1f')
      });
    }
    return metadata;
  }

  sortCommitsParentFirst(commits) {
    const byHash = new Map(commits.map(commit => [commit.hash, commit]));
    const indegree = new Map(commits.map(commit => [commit.hash, 0]));
    const children = new Map(commits.map(commit => [commit.hash, []]));
    for (const commit of commits) {
      for (const parent of commit.parents) {
        if (!byHash.has(parent)) continue;
        indegree.set(commit.hash, indegree.get(commit.hash) + 1);
        children.get(parent).push(commit.hash);
      }
    }
    const ready = commits
      .filter(commit => indegree.get(commit.hash) === 0)
      .sort((left, right) => left.timestamp - right.timestamp);
    const ordered = [];
    while (ready.length) {
      const commit = ready.shift();
      ordered.push(commit);
      for (const childHash of children.get(commit.hash)) {
        indegree.set(childHash, indegree.get(childHash) - 1);
        if (indegree.get(childHash) === 0) {
          ready.push(byHash.get(childHash));
          ready.sort((left, right) => left.timestamp - right.timestamp);
        }
      }
    }
    return ordered.length === commits.length
      ? ordered
      : [...commits].sort((left, right) => left.timestamp - right.timestamp);
  }

  async isAncestor(ancestor, descendant) {
    try {
      await execFileAsync(
        'git',
        ['merge-base', '--is-ancestor', ancestor, descendant],
        { cwd: this.repoPath, windowsHide: true }
      );
      return true;
    } catch (error) {
      if (error.code === 1) return false;
      throw error;
    }
  }

  async getCommitFiles(commits) {
    const files = new Set();
    for (const commit of commits) {
      const raw = await this.git.raw([
        'show',
        '--pretty=format:',
        '--name-only',
        '-z',
        commit.hash
      ]);
      raw.split('\0').filter(Boolean).forEach(file => files.add(file));
    }
    return [...files];
  }

  async previewCommitAction(action, hashes) {
    if (!['rebase', 'cherry-pick'].includes(action)) {
      throw new Error(`Invalid commit action: ${action}`);
    }
    const commits = await this.getCommitActionMetadata(hashes);
    const [status, operation, head] = await Promise.all([
      this.git.status(),
      this.getOperationState(),
      this.git.revparse(['HEAD']).then(value => value.trim())
    ]);
    const base = {
      action,
      target: commits[0]?.hash || null,
      commits,
      files: [],
      workingTree: {
        clean: status.isClean(),
        files: status.files.map(file => file.path)
      },
      pendingOperation: operation.type,
      detached: Boolean(status.detached),
      allowed: true,
      reason: ''
    };
    if (operation.type) {
      return {
        ...base,
        allowed: false,
        reason: `Finish or abort the pending ${operation.type} first`
      };
    }
    if (!status.isClean()) {
      return { ...base, allowed: false, reason: 'The working tree must be clean' };
    }

    if (action === 'rebase') {
      if (commits.length !== 1) {
        return { ...base, allowed: false, reason: 'Rebase requires one target commit' };
      }
      if (status.detached) {
        return { ...base, allowed: false, reason: 'Rebase is unavailable in detached HEAD' };
      }
      if (commits[0].hash === head) {
        return { ...base, allowed: false, reason: 'HEAD is already at this commit' };
      }
      if (await this.isAncestor(commits[0].hash, head)) {
        return {
          ...base,
          allowed: false,
          reason: 'The selected target is already an ancestor of HEAD'
        };
      }
      const replayHashes = (await this.git.raw([
        'rev-list',
        '--reverse',
        `${commits[0].hash}..HEAD`
      ])).split(/\r?\n/).filter(Boolean);
      const replay = replayHashes.length
        ? await this.getCommitActionMetadata(replayHashes)
        : [];
      const files = (await this.git.diff([
        '--no-ext-diff',
        '--name-only',
        `${commits[0].hash}...HEAD`
      ])).split(/\r?\n/).filter(Boolean);
      return { ...base, commits: replay, files };
    }

    const ordered = this.sortCommitsParentFirst(commits);
    if (ordered.some(commit => commit.parents.length > 1)) {
      return {
        ...base,
        commits: ordered,
        allowed: false,
        reason: 'Merge commits require a mainline and cannot be cherry-picked here'
      };
    }
    return {
      ...base,
      commits: ordered,
      files: await this.getCommitFiles(ordered)
    };
  }

  async rebaseOntoCommit(hash) {
    const preview = await this.previewCommitAction('rebase', [hash]);
    if (!preview.allowed) throw new Error(preview.reason);
    try {
      const result = await this.git.rebase([hash]);
      return {
        success: true,
        target: hash,
        head: (await this.git.revparse(['HEAD'])).trim(),
        result
      };
    } catch (error) {
      throw new Error(`Failed to rebase onto commit: ${error.message}`, { cause: error });
    }
  }

  async cherryPickCommits(hashes) {
    const preview = await this.previewCommitAction('cherry-pick', hashes);
    if (!preview.allowed) throw new Error(preview.reason);
    try {
      await this.git.raw(['cherry-pick', ...preview.commits.map(commit => commit.hash)]);
      return {
        success: true,
        commits: preview.commits.map(commit => commit.hash),
        head: (await this.git.revparse(['HEAD'])).trim()
      };
    } catch (error) {
      throw new Error(`Failed to cherry-pick: ${error.message}`, { cause: error });
    }
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
      throw new Error(`Failed to create branch: ${err.message}`, { cause: err });
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
    if (!status.isClean()) {
      const blocking = await this.mergeBlockingFiles(branch, status);
      if (blocking.length) {
        throw new Error(
          `The merge would overwrite local changes in: ${blocking.join(', ')}`
        );
      }
    }
    try {
      const result = await this.git.merge([flag, branch]);
      return { success: true, branch, strategy, result };
    } catch (err) {
      throw new Error(`Failed to merge: ${err.message}`, { cause: err });
    }
  }

  async mergeBlockingFiles(branch, status) {
    const changedRaw = await this.git.raw(['diff', '--name-only', `HEAD...${branch}`]);
    const incoming = new Set(changedRaw.split(/\r?\n/).filter(Boolean));
    if (!incoming.size) return [];
    const local = [
      ...(status.files || []).map(file => file.path),
      ...(status.modified || []),
      ...(status.not_added || []),
      ...(status.created || []),
      ...(status.deleted || []),
      ...(status.staged || []),
      ...(status.conflicted || []),
      ...(status.renamed || []).flatMap(file => [file.from, file.to])
    ].filter(Boolean);
    return [...new Set(local.filter(file => incoming.has(file)))];
  }

  async previewMerge(branch) {
    await this.assertCommitish(branch);
    const fallback = () => ({
      supported: false,
      canFastForward: null,
      conflictedFiles: [],
      changedFiles: []
    });
    let stdout;
    try {
      ({ stdout } = await execFileAsync(
        'git',
        ['merge-tree', '--write-tree', '--name-only', 'HEAD', branch],
        { cwd: this.repoPath, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }
      ));
    } catch (err) {
      stdout = String(err.stdout || '');
      if (!stdout) return fallback();
    }
    const conflictedFiles = [];
    const lines = String(stdout).split(/\r?\n/);
    for (let index = 1; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line || /^warning|^error|^Auto-merging/i.test(line)) continue;
      if (/^CONFLICT\b/i.test(line)) {
        let match = line.match(/^CONFLICT\b.*\bin\s+(\S+)/i);
        if (!match) match = line.match(/^CONFLICT\b[^:]*:\s*(\S+)/i);
        if (match) conflictedFiles.push(match[1]);
      }
    }
    try {
      const base = (await this.git.raw(['merge-base', 'HEAD', branch])).trim();
      const head = (await this.git.revparse(['HEAD'])).trim();
      const changedRaw = await this.git.raw(['diff', '--name-only', `${base}..${branch}`]);
      return {
        supported: true,
        canFastForward: base === head,
        conflictedFiles,
        changedFiles: changedRaw.split(/\r?\n/).filter(Boolean)
      };
    } catch {
      return {
        supported: true,
        canFastForward: null,
        conflictedFiles,
        changedFiles: []
      };
    }
  }

  parseConflictBlocks(content) {
    return parseConflictBlocks(String(content || ''));
  }

  async getOperationState() {
    const mergePath = await this.resolveGitPath('MERGE_HEAD');
    const rebaseMergePath = await this.resolveGitPath('rebase-merge');
    const rebaseApplyPath = await this.resolveGitPath('rebase-apply');
    const cherryPickPath = await this.resolveGitPath('CHERRY_PICK_HEAD');
    const sequencerPath = await this.resolveGitPath('sequencer');
    let type = null;
    if (fs.existsSync(mergePath)) type = 'merge';
    else if (fs.existsSync(rebaseMergePath) || fs.existsSync(rebaseApplyPath)) type = 'rebase';
    else if (fs.existsSync(cherryPickPath) || fs.existsSync(sequencerPath)) {
      type = 'cherry-pick';
    }

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
    const resultText = decode(result);
    const snapshotId = conflictSnapshot(buffers);

    return {
      snapshotId,
      path: relativePath,
      binary,
      eol: resultText.includes('\r\n') ? 'crlf' : 'lf',
      base: decode(base),
      current: decode(ours),
      incoming: decode(theirs),
      result: resultText,
      blocks: binary ? [] : parseConflictBlocks(resultText),
      // Compatibility aliases for integrations that still use Git's ours/theirs labels.
      ours: decode(ours),
      theirs: decode(theirs)
    };
  }

  async resolveConflict(filePath, resolution) {
    const relativePath = this.validateRepositoryPath(filePath);
    const state = await this.getOperationState();
    if (!state.type || !state.conflicts.includes(relativePath)) {
      throw new Error(`File is not conflicted: ${relativePath}`);
    }

    const strategy = resolution?.strategy;
    const conflict = await this.readConflict(relativePath);
    if (
      typeof resolution?.snapshotId !== 'string' ||
      resolution.snapshotId !== conflict.snapshotId
    ) {
      throw new Error('The conflicted file changed externally. Reload it before resolving.');
    }
    if (strategy === 'manual') {
      if (typeof resolution.content !== 'string') {
        throw new Error('Manual conflict resolution requires text content');
      }
      if (conflict.binary) throw new Error('Binary conflicts cannot be edited as text');
      if (Buffer.byteLength(resolution.content, 'utf8') > MAX_CONFLICT_RESULT_BYTES) {
        throw new Error('Conflict result is too large');
      }
      if (hasUnresolvedMarkers(resolution.content)) {
        throw new Error('The result still contains unresolved conflict markers');
      }
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
    if (!state.type) throw new Error('No Git operation is in progress');
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
      throw new Error(`Failed to continue ${state.type}: ${err.message}`, { cause: err });
    }
  }

  async abortOperation() {
    const state = await this.getOperationState();
    if (!state.type) throw new Error('No Git operation is in progress');
    try {
      await this.git.raw([state.type, '--abort']);
      return { success: true, state: await this.getOperationState() };
    } catch (err) {
      throw new Error(`Failed to abort ${state.type}: ${err.message}`, { cause: err });
    }
  }

  async skipOperation() {
    const state = await this.getOperationState();
    if (!['rebase', 'cherry-pick'].includes(state.type)) {
      throw new Error('Only rebase and cherry-pick operations can skip a commit');
    }
    try {
      await this.git.raw([state.type, '--skip']);
      return { success: true, state: await this.getOperationState() };
    } catch (error) {
      throw new Error(`Failed to skip ${state.type}: ${error.message}`, { cause: error });
    }
  }

  async resolveGitPath(name) {
    const value = (await this.git.raw(['rev-parse', '--git-path', name])).trim();
    return path.isAbsolute(value) ? value : path.resolve(this.repoPath, value);
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
      throw new Error(`Failed to get status: ${err.message}`, { cause: err });
    }
  }

  async getWorkingTree() {
    await this.assertNoPendingOperation();
    const status = await this.git.status();
    const files = status.files.map(file => {
      const indexStatus = file.index || ' ';
      const worktreeStatus = file.working_dir || ' ';
      const untracked = indexStatus === '?' && worktreeStatus === '?';
      const staged = !untracked && indexStatus !== ' ';
      const unstaged = untracked || worktreeStatus !== ' ';
      return {
        path: this.validateRepositoryPath(file.path, { rejectSymlinks: false }),
        oldPath: file.from ? this.validateRepositoryPath(file.from, { rejectSymlinks: false }) : undefined,
        indexStatus,
        worktreeStatus,
        staged,
        unstaged,
        untracked,
        conflicted: status.conflicted.includes(file.path),
        binary: false
      };
    });
    const submodulePaths = new Set();
    let submodules = [];
    if (fs.existsSync(path.join(this.repoPath, '.gitmodules'))) {
      try {
        submodules = await this.getSubmodules();
        for (const submodule of submodules) {
          submodulePaths.add(submodule.path);
        }
      } catch { /* submodule detection is best effort */ }
    }
    files.forEach(file => {
      file.submodule = submodulePaths.has(file.path);
    });
    const fileState = await Promise.all(
      files.map(async file => {
        try {
          const stat = await fs.promises.lstat(path.resolve(this.repoPath, file.path));
          return [file.path, stat.size, stat.mtimeMs];
        } catch {
          return [file.path, null, null];
        }
      })
    );
    let indexState;
    try {
      indexState = await this.git.raw(['diff', '--cached', '--raw', '-z']);
    } catch {
      indexState = await this.git.raw(['ls-files', '--stage', '-z']);
    }
    const snapshotId = crypto
      .createHash('sha256')
      .update(JSON.stringify({
        current: status.current,
        files: files.map(file => [
          file.path,
          file.indexStatus,
          file.worktreeStatus
        ]),
        fileState,
        indexState
      }))
      .digest('hex');
    return {
      snapshotId,
      branch: status.current,
      files,
      submodules,
      stagedCount: files.filter(file => file.staged).length,
      unstagedCount: files.filter(file => file.unstaged).length
    };
  }

  async assertWorkingTreeSnapshot(snapshotId) {
    if (typeof snapshotId !== 'string' || !/^[a-f0-9]{64}$/.test(snapshotId)) {
      throw new Error('Invalid working tree snapshot');
    }
    const current = await this.getWorkingTree();
    if (current.snapshotId !== snapshotId) {
      throw new Error('Working tree changed; refresh Changes and try again');
    }
  }

  validatePathList(paths) {
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > 500) {
      throw new Error('Select between 1 and 500 repository paths');
    }
    return [...new Set(paths.map(filePath => this.validateRepositoryPath(filePath)))];
  }

  async stagePaths(snapshotId, paths) {
    await this.assertWorkingTreeSnapshot(snapshotId);
    const safePaths = this.validatePathList(paths);
    await this.git.add(['--', ...safePaths]);
    return { success: true, snapshot: await this.getWorkingTree() };
  }

  async unstagePaths(snapshotId, paths) {
    await this.assertWorkingTreeSnapshot(snapshotId);
    const safePaths = this.validatePathList(paths);
    try {
      await this.git.revparse(['--verify', 'HEAD']);
      await this.git.raw(['restore', '--staged', '--', ...safePaths]);
    } catch (error) {
      if (!/unknown revision|needed a single revision|ambiguous argument/i.test(error.message)) {
        throw error;
      }
      await this.git.raw(['rm', '--cached', '--ignore-unmatch', '--', ...safePaths]);
    }
    return { success: true, snapshot: await this.getWorkingTree() };
  }

  async discardPaths(snapshotId, paths) {
    await this.assertWorkingTreeSnapshot(snapshotId);
    const safePaths = this.validatePathList(paths);
    const status = await this.git.status();
    const conflicted = new Set(status.conflicted || []);
    const untracked = new Set(status.not_added || []);
    const tracked = [];
    const untrackedToRemove = [];
    for (const relativePath of safePaths) {
      if (conflicted.has(relativePath)) {
        throw new Error(`Resolve the conflict in ${relativePath} before discarding it`);
      }
      if (untracked.has(relativePath)) untrackedToRemove.push(relativePath);
      else tracked.push(relativePath);
    }
    if (tracked.length) {
      await this.git.raw(['restore', '--worktree', '--', ...tracked]);
    }
    for (const relativePath of untrackedToRemove) {
      await fs.promises.rm(path.resolve(this.repoPath, relativePath), {
        recursive: true,
        force: true
      });
    }
    return { success: true, snapshot: await this.getWorkingTree() };
  }

  async getWorkingDiff(filePath, staged = false) {
    const parsed = await this.getParsedWorkingDiff(filePath, staged);
    return {
      path: parsed.path,
      staged: parsed.staged,
      binary: parsed.binary,
      hunks: parsed.hunks.map(hunk => {
        const copy = { ...hunk };
        delete copy.raw;
        return copy;
      })
    };
  }

  async getParsedWorkingDiff(filePath, staged = false) {
    const relativePath = this.validateRepositoryPath(filePath);
    const args = [
      'diff',
      ...(staged ? ['--cached'] : []),
      '--no-ext-diff',
      '--binary',
      '--unified=3',
      '--',
      relativePath
    ];
    let patch = await this.git.raw(args);
    if (!staged && !patch) {
      const status = await this.git.status();
      const statusFile = status.files.find(file => file.path === relativePath);
      if (statusFile?.index === '?' && statusFile?.working_dir === '?') {
        try {
          const result = await execFileAsync(
            'git',
            [
              'diff',
              '--no-index',
              '--no-ext-diff',
              '--binary',
              '--unified=3',
              '--',
              '/dev/null',
              relativePath
            ],
            {
              cwd: this.repoPath,
              encoding: 'utf8',
              maxBuffer: 50 * 1024 * 1024,
              windowsHide: true
            }
          );
          patch = result.stdout;
        } catch (error) {
          if (error.code !== 1) throw error;
          patch = error.stdout || '';
        }
      } else if (statusFile && statusFile.index !== '?' && statusFile.working_dir !== '?') {
        return { path: relativePath, staged: false, binary: false, hunks: [], noDiff: true, reason: 'working-tree-matches-index' };
      }
    }
    return this.parseWorkingDiff(relativePath, Boolean(staged), patch);
  }

  parseWorkingDiff(relativePath, staged, patch) {
    const binary = /^(?:GIT binary patch|Binary files .* differ)$/m.test(patch);
    const firstHunk = patch.search(/^@@ /m);
    const prelude = firstHunk === -1 ? patch : patch.slice(0, firstHunk);
    const hunks = [];
    if (firstHunk !== -1) {
      const source = patch.slice(firstHunk);
      const starts = [];
      const matcher = /^@@ /gm;
      let match;
      while ((match = matcher.exec(source))) starts.push(match.index);
      for (let index = 0; index < starts.length; index += 1) {
        const raw = source.slice(starts[index], starts[index + 1] ?? source.length);
        const [header = '', ...body] = raw.replace(/\n$/, '').split('\n');
        const range = header.match(
          /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
        );
        const id = crypto
          .createHash('sha256')
          .update(`${staged ? 'staged' : 'unstaged'}\0${relativePath}\0${raw}`)
          .digest('hex');
        hunks.push({
          id,
          header,
          oldRange: range
            ? { start: Number(range[1]), lines: Number(range[2] ?? 1) }
            : null,
          newRange: range
            ? { start: Number(range[3]), lines: Number(range[4] ?? 1) }
            : null,
          lines: body.map(line => ({
            type: line.startsWith('+')
              ? 'add'
              : line.startsWith('-')
                ? 'delete'
                : 'context',
            content: line
          })),
          raw
        });
      }
    }
    return { path: relativePath, staged, binary, hunks, prelude };
  }

  validateHunkIds(hunkIds) {
    if (!Array.isArray(hunkIds) || hunkIds.length === 0 || hunkIds.length > 200) {
      throw new Error('Select between 1 and 200 diff hunks');
    }
    const unique = [...new Set(hunkIds)];
    if (unique.some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))) {
      throw new Error('Invalid diff hunk');
    }
    return unique;
  }

  async stageHunks(snapshotId, filePath, hunkIds) {
    return this.applyWorkingHunks(snapshotId, filePath, hunkIds, false);
  }

  async unstageHunks(snapshotId, filePath, hunkIds) {
    return this.applyWorkingHunks(snapshotId, filePath, hunkIds, true);
  }

  async applyWorkingHunks(snapshotId, filePath, hunkIds, reverse) {
    await this.assertWorkingTreeSnapshot(snapshotId);
    const relativePath = this.validateRepositoryPath(filePath);
    const selectedIds = this.validateHunkIds(hunkIds);
    const diff = await this.getParsedWorkingDiff(relativePath, reverse);
    if (diff.binary) throw new Error('Binary files can only be staged as a whole');
    const available = new Map(diff.hunks.map(hunk => [hunk.id, hunk]));
    const selected = selectedIds.map(id => available.get(id));
    if (selected.some(hunk => !hunk)) {
      throw new Error('Working tree changed; refresh Changes and try again');
    }
    const patch = `${diff.prelude}${selected.map(hunk => hunk.raw).join('')}`;
    const args = ['apply', '--cached', '--recount', '--whitespace=nowarn'];
    if (reverse) args.push('--reverse');
    args.push('-');
    await this.runGitWithInput(args, patch);
    return { success: true, snapshot: await this.getWorkingTree() };
  }

  runGitWithInput(args, input) {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, {
        cwd: this.repoPath,
        windowsHide: true,
        env: process.env
      });
      const stdout = [];
      const stderr = [];
      let outputSize = 0;
      const collect = target => chunk => {
        outputSize += chunk.length;
        if (outputSize > 50 * 1024 * 1024) {
          child.kill();
          reject(new Error('Git output exceeded the safe limit'));
          return;
        }
        target.push(chunk);
      };
      child.stdout.on('data', collect(stdout));
      child.stderr.on('data', collect(stderr));
      child.on('error', reject);
      child.on('close', code => {
        const errorText = Buffer.concat(stderr).toString('utf8').trim();
        if (code !== 0) {
          reject(new Error(errorText || `Git exited with code ${code}`));
          return;
        }
        resolve(Buffer.concat(stdout).toString('utf8'));
      });
      child.stdin.end(input, 'utf8');
    });
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
    try {
      const raw = await this.git.raw(['worktree', 'list', '--porcelain']);
      const worktrees = [];
      let current = null;
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith('worktree ')) {
          if (current) worktrees.push(current);
          current = { path: line.slice('worktree '.length) };
        } else if (line.startsWith('branch ')) {
          current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
        } else if (line.startsWith('HEAD ')) {
          current.head = line.slice('HEAD '.length);
        }
      }
      if (current) worktrees.push(current);
      return worktrees;
    } catch (error) {
      throw new Error(`Failed to get worktrees: ${error.message}`, { cause: error });
    }
  }

  async createWorktree(directory, branch) {
    await this.assertNoPendingOperation();
    await this.assertValidBranchName(branch);
    if (
      typeof directory !== 'string' ||
      !path.isAbsolute(directory) ||
      /[\0\r\n]/.test(directory)
    ) {
      throw new Error('Invalid worktree directory');
    }
    try {
      await this.git.raw(['worktree', 'add', '-b', branch, directory]);
      return { success: true, path: directory, branch };
    } catch (error) {
      throw new Error(`Failed to create worktree: ${error.message}`, { cause: error });
    }
  }

  async removeWorktree(directory) {
    if (
      typeof directory !== 'string' ||
      !path.isAbsolute(directory) ||
      /[\0\r\n]/.test(directory)
    ) {
      throw new Error('Invalid worktree directory');
    }
    try {
      await this.git.raw(['worktree', 'remove', directory]);
      return { success: true, path: directory };
    } catch (error) {
      throw new Error(`Failed to remove worktree: ${error.message}`, { cause: error });
    }
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
