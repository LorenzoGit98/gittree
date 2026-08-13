const AiSettingsStore = require('./ai-store');
const { parseAiOutput, buildCommitPrompt, buildPrPrompt } = require('./ai-output');
const { requestOpenAiCompatible, requestAnthropic } = require('./ai-providers');
const { generateWithOpencode } = require('./ai-opencode');
const { environmentForAi } = require('./ai-env');

const PROVIDERS = ['opencode', 'openai', 'anthropic'];
const LANGUAGES = ['auto', 'en', 'it'];
const DIFF_LIMIT = 24 * 1024;
const DEFAULT_TIMEouts = { http: 60_000, opencode: 120_000 };

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function validateBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Invalid AI base URL');
  }
  const https = parsed.protocol === 'https:';
  const loopback = parsed.protocol === 'http:'
    && LOOPBACK_HOSTS.has(parsed.hostname);
  if (!https && !loopback) {
    throw new Error('The AI base URL must use HTTPS (or HTTP on localhost)');
  }
  return parsed;
}

function validateKey(value) {
  const key = String(value || '').trim();
  if (key.length < 4 || key.length > 400 || /[\r\n\0]/.test(key)) {
    throw new Error('Invalid API key');
  }
  return key;
}

function validateSettingsInput(input = {}) {
  const provider = String(input.provider || '');
  if (!PROVIDERS.includes(provider)) throw new Error('Unsupported AI provider');
  const language = LANGUAGES.includes(input.language) ? input.language : 'auto';
  const baseUrl = String(input.baseUrl || '').trim();
  const model = String(input.model || '').trim().slice(0, 200);
  if (provider === 'openai') {
    if (!baseUrl) throw new Error('A base URL is required for this provider');
    validateBaseUrl(baseUrl);
    if (!model) throw new Error('A model is required for this provider');
  }
  if (provider === 'anthropic' && !model) {
    throw new Error('A model is required for this provider');
  }
  return { provider, baseUrl, model, language };
}

function truncateDiff(diff) {
  const text = String(diff || '');
  if (text.length <= DIFF_LIMIT) return text;
  return `${text.slice(0, DIFF_LIMIT)}\n\n... diff truncated ...`;
}

class AiService {
  constructor({
    storagePath,
    vault,
    fetch,
    spawn,
    resolveExecutable,
    getStagedDiff = async () => '',
    getUnstagedDiff = async () => '',
    getBranchComparison = async () => ({ commits: [], diff: '' }),
    timeouts = DEFAULT_TIMEouts
  }) {
    if (!storagePath) throw new Error('AI settings storage path is required');
    if (!vault) throw new Error('Credential vault is required');
    if (!fetch) throw new Error('Fetch is required');
    if (!spawn) throw new Error('PTY spawn is required');
    this.store = new AiSettingsStore({ storagePath });
    this.vault = vault;
    this.fetch = fetch;
    this.spawn = spawn;
    this.resolveExecutable = resolveExecutable || (command => command);
    this.getStagedDiff = getStagedDiff;
    this.getUnstagedDiff = getUnstagedDiff;
    this.getBranchComparison = getBranchComparison;
    this.timeouts = { ...DEFAULT_TIMEouts, ...(timeouts || {}) };
    const restored = this.store.load();
    this.settings = restored.settings;
    this.agentEnvironment = {};
    this.keyConfigured = false;
  }

  async initialize() {
    const account = await this.vault.getAccount('ai');
    this.keyConfigured = Boolean(account?.apiKey);
    this.agentEnvironment = environmentForAi({
      provider: this.settings.provider,
      baseUrl: this.settings.baseUrl,
      apiKey: account?.apiKey || ''
    });
  }

  async getSettings() {
    return {
      ...this.settings,
      keyConfigured: this.keyConfigured
    };
  }

  async setSettings(input) {
    const settings = validateSettingsInput(input);
    this.settings = settings;
    this.store.save({ settings });
    const account = await this.vault.getAccount('ai');
    this.agentEnvironment = environmentForAi({
      provider: settings.provider,
      baseUrl: settings.baseUrl,
      apiKey: account?.apiKey || ''
    });
    return this.getSettings();
  }

  async setKey(key) {
    const apiKey = validateKey(key);
    await this.vault.setAccount('ai', { apiKey });
    this.keyConfigured = true;
    this.agentEnvironment = environmentForAi({
      provider: this.settings.provider,
      baseUrl: this.settings.baseUrl,
      apiKey
    });
    return { keyConfigured: true };
  }

  async clearKey() {
    await this.vault.removeAccount('ai');
    this.keyConfigured = false;
    this.agentEnvironment = environmentForAi({
      provider: this.settings.provider,
      baseUrl: this.settings.baseUrl,
      apiKey: ''
    });
    return { keyConfigured: false };
  }

  getAgentEnvironment() {
    return { ...this.agentEnvironment };
  }

  async apiKey() {
    const account = await this.vault.getAccount('ai');
    return account?.apiKey || '';
  }

  normalizeLanguage(value) {
    const language = String(value || '');
    if (language === 'it' || language === 'en') return language;
    if (this.settings.language === 'it' || this.settings.language === 'en') {
      return this.settings.language;
    }
    return 'en';
  }

  async generateCommitMessage(repoPath, options = {}) {
    const staged = await this.getStagedDiff(repoPath);
    let diff = String(staged || '');
    if (!diff.trim()) {
      diff = String(await this.getUnstagedDiff(repoPath) || '');
    }
    if (!diff.trim()) {
      throw new Error('No changes to generate a commit message from');
    }
    const language = this.normalizeLanguage(options.language);
    const prompt = buildCommitPrompt({
      diff: truncateDiff(diff),
      hint: String(options.hint || '').slice(0, 500),
      language
    });
    const raw = await this.runProvider(prompt);
    return parseAiOutput(raw);
  }

  async generatePrDescription(repoPath, options = {}) {
    const source = String(options.source || '').trim();
    const target = String(options.target || '').trim();
    if (!source || !target || source === target) {
      throw new Error('Invalid source and target branches');
    }
    const comparison = await this.getBranchComparison(repoPath, target, source);
    const commits = (comparison?.commits || [])
      .map(commit => String(commit?.subject || commit?.message || '').split('\n')[0].trim())
      .filter(Boolean);
    const language = this.normalizeLanguage(options.language);
    const prompt = buildPrPrompt({
      diff: truncateDiff(comparison?.diff || ''),
      commits,
      hint: String(options.hint || '').slice(0, 500),
      language
    });
    const raw = await this.runProvider(prompt);
    return parseAiOutput(raw, { maxTitleLength: 256 });
  }

  async testConnection() {
    const raw = await this.runProvider('Reply with exactly: OK');
    return { ok: true, reply: String(raw).trim().slice(0, 120) };
  }

  async runProvider(prompt) {
    if (this.settings.provider === 'opencode') {
      const executable = this.resolveExecutable('opencode');
      if (!executable) throw new Error('OpenCode CLI not found');
      return generateWithOpencode({
        spawn: this.spawn,
        executable,
        prompt,
        model: this.settings.model || '',
        timeoutMs: this.timeouts.opencode
      });
    }
    const apiKey = await this.apiKey();
    if (!apiKey) throw new Error('Configure the AI API key in Settings first');
    if (this.settings.provider === 'anthropic') {
      return requestAnthropic({
        fetch: this.fetch,
        apiKey,
        model: this.settings.model,
        prompt,
        timeoutMs: this.timeouts.http
      });
    }
    return requestOpenAiCompatible({
      fetch: this.fetch,
      baseUrl: this.settings.baseUrl,
      apiKey,
      model: this.settings.model,
      prompt,
      timeoutMs: this.timeouts.http
    });
  }
}

module.exports = AiService;
module.exports.validateSettingsInput = validateSettingsInput;
module.exports.validateKey = validateKey;
module.exports.validateBaseUrl = validateBaseUrl;
