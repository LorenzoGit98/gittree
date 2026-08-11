const { AsyncLocalStorage } = require('node:async_hooks');

class RepositoryQueue {
  constructor() {
    this.tail = Promise.resolve();
    this.context = new AsyncLocalStorage();
  }

  isCurrent() {
    return this.context.getStore() === this;
  }

  runExclusive(operation) {
    if (this.isCurrent()) return operation();
    const run = () => this.context.run(this, operation);
    const task = this.tail.then(run, run);
    this.tail = task.then(() => {}, () => {});
    return task;
  }
}

module.exports = RepositoryQueue;
