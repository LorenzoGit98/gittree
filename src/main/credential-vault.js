const fs = require('node:fs');
const path = require('node:path');

class CredentialVault {
  constructor(options) {
    this.storagePath = options.storagePath;
    this.safeStorage = options.safeStorage;
    this.platform = options.platform || process.platform;
    this.state = { accounts: {}, reviewDrafts: {} };
    this.loaded = false;
    this.loading = null;
    this.writeQueue = Promise.resolve();
  }

  getSecurityState() {
    const encryptionAvailable = Boolean(this.safeStorage?.isEncryptionAvailable?.());
    let backend = '';
    try {
      backend = this.safeStorage?.getSelectedStorageBackend?.() || '';
    } catch {}
    const memoryOnly =
      !encryptionAvailable ||
      (this.platform === 'linux' && backend === 'basic_text');
    return {
      encryptionAvailable,
      backend,
      memoryOnly,
      warning: memoryOnly
        ? 'Secure OS encryption is unavailable; credentials are kept in memory only'
        : ''
    };
  }

  validateProvider(provider) {
    if (!['github', 'gitlab'].includes(provider)) {
      throw new Error(`Unsupported hosting provider: ${provider}`);
    }
    return provider;
  }

  async ensureLoaded() {
    if (this.loaded) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      if (!this.getSecurityState().memoryOnly) {
        try {
          const encrypted = await fs.promises.readFile(this.storagePath);
          const plaintext = this.safeStorage.decryptString(encrypted);
          const parsed = JSON.parse(plaintext);
          this.state = {
            accounts: parsed.accounts && typeof parsed.accounts === 'object'
              ? parsed.accounts
              : {},
            reviewDrafts: parsed.reviewDrafts && typeof parsed.reviewDrafts === 'object'
              ? parsed.reviewDrafts
              : {}
          };
        } catch (error) {
          if (error.code !== 'ENOENT') {
            throw new Error('The encrypted hosting vault could not be read');
          }
        }
      }
      this.loaded = true;
    })().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  async persist() {
    if (this.getSecurityState().memoryOnly) return;
    const plaintext = JSON.stringify(this.state);
    const encrypted = this.safeStorage.encryptString(plaintext);
    const directory = path.dirname(this.storagePath);
    const temporaryPath = `${this.storagePath}.tmp`;
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.promises.mkdir(directory, { recursive: true });
      await fs.promises.writeFile(temporaryPath, encrypted, { mode: 0o600 });
      await fs.promises.rename(temporaryPath, this.storagePath);
    });
    return this.writeQueue;
  }

  async getAccount(provider) {
    await this.ensureLoaded();
    return this.state.accounts[this.validateProvider(provider)] || null;
  }

  async setAccount(provider, account) {
    await this.ensureLoaded();
    this.state.accounts[this.validateProvider(provider)] = account;
    await this.persist();
  }

  async removeAccount(provider) {
    await this.ensureLoaded();
    delete this.state.accounts[this.validateProvider(provider)];
    await this.persist();
  }

  validateDraftKey(key) {
    if (
      typeof key !== 'string' ||
      key.length < 3 ||
      key.length > 1000 ||
      /[\r\n\0]/.test(key)
    ) {
      throw new Error('Invalid review draft key');
    }
    return key;
  }

  async getReviewDraft(key) {
    await this.ensureLoaded();
    return this.state.reviewDrafts[this.validateDraftKey(key)] || null;
  }

  async saveReviewDraft(key, draft) {
    await this.ensureLoaded();
    this.state.reviewDrafts[this.validateDraftKey(key)] = draft;
    await this.persist();
  }

  async removeReviewDraft(key) {
    await this.ensureLoaded();
    delete this.state.reviewDrafts[this.validateDraftKey(key)];
    await this.persist();
  }
}

module.exports = CredentialVault;
