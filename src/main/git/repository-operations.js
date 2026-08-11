const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const {
  MAX_CONFLICT_RESULT_BYTES,
  conflictSnapshot,
  hasUnresolvedMarkers,
  parseConflictBlocks
} = require('../conflict-model');

const execFileAsync = promisify(execFile);

class RepositoryOperations {
  constructor({ git, repoPath, assertCommitish, validateRepositoryPath }) {
    this.git = git;
    this.repoPath = repoPath;
    this.assertCommitish = assertCommitish;
    this.validateRepositoryPath = validateRepositoryPath;
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
    } catch (error) {
      throw new Error(`Failed to rebase onto ${branch}: ${error.message}`, { cause: error });
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

  async assertNoPendingOperation() {
    const state = await this.getOperationState();
    if (state.type) {
      throw new Error(`Finish or abort the pending ${state.type} before changing branches`);
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
    } catch (error) {
      throw new Error(`Failed to merge: ${error.message}`, { cause: error });
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
    } catch (error) {
      stdout = String(error.stdout || '');
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
    } catch (error) {
      throw new Error(`Failed to continue ${state.type}: ${error.message}`, { cause: error });
    }
  }

  async abortOperation() {
    const state = await this.getOperationState();
    if (!state.type) throw new Error('No Git operation is in progress');
    try {
      await this.git.raw([state.type, '--abort']);
      return { success: true, state: await this.getOperationState() };
    } catch (error) {
      throw new Error(`Failed to abort ${state.type}: ${error.message}`, { cause: error });
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
}

module.exports = RepositoryOperations;
