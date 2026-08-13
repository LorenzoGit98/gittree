(function exposePrCreatePrefill(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PrCreatePrefill = api;
})(typeof window !== 'undefined' ? window : globalThis, function createPrCreatePrefill() {
  const MAX_TITLE_LENGTH = 256;
  const MAX_WORK_ITEMS = 20;
  const HASH_PREFIX_LENGTH = 8;
  const REFERENCED_ID_PATTERN = /(?:AB)?#(\d+)/gi;
  const BARE_BRANCH_ID_PATTERN = /(?:^|[/_-])(\d{5,})(?=[-_/]|$)/g;

  function subjectOf(commit) {
    return String(commit?.message || '').split('\n')[0].trim();
  }

  function collectWorkItemIds(branch, commits) {
    const ids = [];
    const seen = new Set();
    const scan = (text, bareIds) => {
      for (const match of String(text || '').matchAll(REFERENCED_ID_PATTERN)) {
        const id = Number(match[1]);
        if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
      if (!bareIds) return;
      for (const match of String(text || '').matchAll(BARE_BRANCH_ID_PATTERN)) {
        const id = Number(match[1]);
        if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
    };
    scan(branch, true);
    for (const commit of commits || []) scan(subjectOf(commit), false);
    return ids.slice(0, MAX_WORK_ITEMS);
  }

  function buildTitle(source, commits) {
    const subject = subjectOf(commits?.[0]);
    const candidate = subject || String(source || '').trim();
    return candidate.slice(0, MAX_TITLE_LENGTH);
  }

  function buildBody(commits) {
    return (commits || [])
      .map(commit => {
        const subject = subjectOf(commit);
        const hash = String(commit?.hash || '').slice(0, HASH_PREFIX_LENGTH);
        return `- ${subject}${hash ? ` (${hash})` : ''}`;
      })
      .join('\n');
  }

  function build({ source, commits }) {
    return {
      title: buildTitle(source, commits),
      body: buildBody(commits),
      workItems: collectWorkItemIds(source, commits)
    };
  }

  return Object.freeze({ build });
});
