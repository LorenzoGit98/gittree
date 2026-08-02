/* exported RepositoryLoadSession */
class RepositoryLoadSession {
  constructor(bridge, repoPath) {
    this.bridge = bridge;
    this.repoPath = repoPath;
    this.reads = new Map();
  }

  branchMetadata() {
    return this.readOnce('branchMetadata', () => this.bridge.getBranchMetadata(this.repoPath));
  }

  status() {
    return this.readOnce('status', () => this.bridge.getStatus(this.repoPath));
  }

  operationState() {
    return this.readOnce('operationState', () => this.bridge.getOperationState(this.repoPath));
  }

  readOnce(key, load) {
    if (!this.reads.has(key)) {
      try {
        this.reads.set(key, Promise.resolve(load()));
      } catch (error) {
        this.reads.set(key, Promise.reject(error));
      }
    }
    return this.reads.get(key);
  }
}

if (typeof module !== 'undefined') module.exports = RepositoryLoadSession;
