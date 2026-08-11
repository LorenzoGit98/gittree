const path = require('node:path');
const simpleGit = require('simple-git');
const RepositoryQueue = require('./repository-queue');

class RepositorySession {
  constructor(repositoryPath, { createGit = simpleGit, queue = new RepositoryQueue() } = {}) {
    this.path = path.resolve(repositoryPath);
    this.git = createGit(this.path);
    this.queue = queue;
  }

  isCurrent() {
    return this.queue.isCurrent();
  }

  runExclusive(operation) {
    return this.queue.runExclusive(operation);
  }
}

module.exports = RepositorySession;
