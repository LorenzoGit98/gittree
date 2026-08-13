function environmentForAi({ provider, baseUrl = '', apiKey = '' }) {
  if (!apiKey) return {};
  const env = {};
  const host = String(baseUrl || '').toLowerCase();
  if (provider === 'anthropic') {
    env.ANTHROPIC_API_KEY = apiKey;
  } else if (host.includes('deepseek')) {
    env.DEEPSEEK_API_KEY = apiKey;
  } else {
    env.OPENAI_API_KEY = apiKey;
    if (baseUrl) env.OPENAI_BASE_URL = baseUrl;
  }
  return env;
}

module.exports = { environmentForAi };
