const fs = require('node:fs');
const path = require('node:path');

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.cache',
  '.next',
  '.nuxt',
  '.parcel-cache',
  '.pnpm-store',
  '.turbo',
  '.yarn',
  'bower_components',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'obj',
  'out',
  'target',
  'vendor'
]);

function isCanceled(signal) {
  return Boolean(signal && signal.aborted);
}

async function hasGitMarker(directoryPath) {
  const markerPath = path.join(directoryPath, '.git');
  try {
    const marker = await fs.promises.lstat(markerPath);
    if (marker.isDirectory()) return true;
    if (!marker.isFile()) return false;
    const value = await fs.promises.readFile(markerPath, 'utf8');
    return /^\s*gitdir\s*:/i.test(value);
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return false;
    throw error;
  }
}

function pathKey(value) {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

async function scanRepositories(rootPath, options = {}) {
  if (typeof rootPath !== 'string' || !rootPath.trim()) {
    throw new TypeError('The workspace root must be a directory.');
  }

  let rootStats;
  try {
    rootStats = await fs.promises.stat(rootPath);
  } catch {
    throw new Error('The workspace root must be an existing directory.');
  }
  if (!rootStats.isDirectory()) {
    throw new Error('The workspace root must be a directory.');
  }

  const root = await fs.promises.realpath(rootPath);
  const signal = options.signal;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const maximumDirectories = Number.isInteger(options.maxDirectories)
    ? Math.max(1, options.maxDirectories)
    : 250000;
  const maximumRepositories = Number.isInteger(options.maxRepositories)
    ? Math.max(1, options.maxRepositories)
    : 10000;
  const queue = [root];
  const repositories = [];
  const knownPaths = new Set();
  let scannedDirectories = 0;
  let skipped = 0;
  let limitReached = false;

  while (queue.length && !isCanceled(signal)) {
    if (scannedDirectories >= maximumDirectories || repositories.length >= maximumRepositories) {
      limitReached = true;
      break;
    }

    const directoryPath = queue.shift();
    scannedDirectories += 1;

    try {
      const repository = await hasGitMarker(directoryPath);
      if (repository) {
        const resolvedPath = await fs.promises.realpath(directoryPath);
        const key = pathKey(resolvedPath);
        if (!knownPaths.has(key)) {
          knownPaths.add(key);
          const item = {
            path: resolvedPath,
            name: path.basename(resolvedPath),
            relativePath: path.relative(root, resolvedPath) || '.'
          };
          repositories.push(item);
          onProgress({ scannedDirectories, repository: item });
        } else {
          onProgress({ scannedDirectories });
        }
        continue;
      }

      const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
      for (const entry of entries) {
        if (isCanceled(signal)) break;
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        if (IGNORED_DIRECTORIES.has(entry.name.toLocaleLowerCase('en-US'))) {
          skipped += 1;
          continue;
        }
        queue.push(path.join(directoryPath, entry.name));
      }
      onProgress({ scannedDirectories });
    } catch {
      skipped += 1;
      onProgress({ scannedDirectories });
    }
  }

  return {
    repositories,
    scannedDirectories,
    skipped,
    canceled: isCanceled(signal),
    limitReached
  };
}

module.exports = {
  IGNORED_DIRECTORIES,
  scanRepositories
};
