const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const simpleGit = require('simple-git');

class RepositorySession {
  constructor(repositoryPath, { createGit = simpleGit } = {}) {
    this.path = path.resolve(repositoryPath);
    this.git = createGit(this.path);
    this.queue = Promise.resolve();
    this.queueContext = new AsyncLocalStorage();
  }

  isCurrent() {
    return this.queueContext.getStore() === this;
  }

  runExclusive(operation) {
    if (this.isCurrent()) return operation();
    const run = () => this.queueContext.run(this, operation);
    const task = this.queue.then(run, run);
    this.queue = task.then(() => {}, () => {});
    return task;
  }
}

module.exports = RepositorySession;
