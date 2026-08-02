class RepositoryHistory {
  constructor({
    git,
    assertSafeRef,
    assertCommitish,
    validateRepositoryPath,
    parseFileDiff
  }) {
    this.git = git;
    this.assertSafeRef = assertSafeRef;
    this.assertCommitish = assertCommitish;
    this.validateRepositoryPath = validateRepositoryPath;
    this.parseFileDiff = parseFileDiff;
  }

  async getLog(maxCount = 100, branch = null) {
    const safeMaxCount = Math.min(1000, Math.max(1, Number(maxCount) || 100));
    if (branch) this.assertSafeRef(branch);
    try {
      const options = { maxCount: safeMaxCount, '--date': 'iso' };
      if (branch) options[branch] = null;
      return await this.git.log(options);
    } catch (error) {
      throw new Error(`Failed to get log: ${error.message}`, { cause: error });
    }
  }

  async getGraphPage(offset = 0, limit = 500) {
    const safeOffset = Math.max(0, Number.isFinite(Number(offset)) ? Number(offset) : 0);
    const safeLimit = Math.min(
      1000,
      Math.max(1, Number.isFinite(Number(limit)) ? Number(limit) : 500)
    );
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
          const [
            hash,
            parentText = '',
            authorName = '',
            authorEmail = '',
            date = '',
            ...subjectParts
          ] = record.split('\x1f');
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
    } catch (error) {
      if (
        /does not have any commits|your current branch .* does not have any commits/i
          .test(error.message)
      ) {
        return { commits: [], refs: [], nextOffset: safeOffset, hasMore: false };
      }
      throw new Error(`Failed to get graph page: ${error.message}`, { cause: error });
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
      } catch (error) {
        throw new Error(`Failed to get diff: ${error.message}`, { cause: error });
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
    } catch (error) {
      throw new Error(`Failed to get diff: ${error.message}`, { cause: error });
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
    } catch (error) {
      throw new Error(`Failed to compare branches: ${error.message}`, { cause: error });
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
    } catch (error) {
      throw new Error(`Failed to compare commits: ${error.message}`, { cause: error });
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
      return this.parseFileDiff(relativePath, false, patch);
    } catch (error) {
      throw new Error(`Failed to get commit file diff: ${error.message}`, { cause: error });
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
        diff,
        files: show.trim().split('\n').filter(Boolean)
      };
    } catch (error) {
      throw new Error(`Failed to get commit detail: ${error.message}`, { cause: error });
    }
  }
}

module.exports = RepositoryHistory;
