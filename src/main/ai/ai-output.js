const TITLE_PATTERN = /^\s*TITLE\s*:\s*(.*)$/im;
const BODY_PATTERN = /^\s*BODY\s*:\s*([\s\S]*)$/im;

function truncate(value, limit) {
  const text = String(value || '').replace(/\s+$/u, '');
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function parseAiOutput(raw, { maxTitleLength = 200, maxBodyLength = 100000 } = {}) {
  const text = String(raw || '');
  const titleMatch = text.match(TITLE_PATTERN);
  const bodyMatch = text.match(BODY_PATTERN);
  let summary;
  let body;
  if (titleMatch) {
    summary = titleMatch[1].trim();
    if (bodyMatch) body = bodyMatch[1].trim();
    else {
      const remainder = text.slice((titleMatch.index || 0) + titleMatch[0].length).trim();
      body = remainder.replace(/^\s*BODY\s*:\s*/i, '').trim();
    }
  } else {
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    summary = lines[0] || '';
    body = lines.slice(1).join('\n').trim();
  }
  if (!summary) {
    throw new Error('The AI provider did not return a commit title');
  }
  return {
    summary: truncate(summary.replace(/^['"`]+|['"`]+$/g, ''), maxTitleLength),
    body: truncate(body, maxBodyLength)
  };
}

function buildCommitPrompt({ diff, hint, language }) {
  const targetLanguage = language === 'it' ? 'Italian' : 'English';
  const hintLine = hint ? `\nAdditional hint from the user: ${hint}\n` : '';
  return [
    'You are the commit-message assistant of a Git desktop client.',
    'Write a commit message for the staged changes below.',
    `Write the title and body in ${targetLanguage}.`,
    'Use a conventional commit prefix when the intent is clear',
    '(feat, fix, refactor, perf, docs, test, chore).',
    'Keep the title under 72 characters, imperative mood, no trailing period.',
    'The body must explain what changed and why, in at most 8 markdown lines.',
    'Answer with exactly this format and nothing else:',
    'TITLE: <title>',
    'BODY: <body>',
    hintLine,
    '--- staged diff ---',
    diff
  ].filter(Boolean).join('\n');
}

function buildPrPrompt({ diff, commits, hint, language }) {
  const targetLanguage = language === 'it' ? 'Italian' : 'English';
  const commitLines = (commits || [])
    .slice(0, 30)
    .map(commit => `- ${commit}`)
    .join('\n');
  const hintLine = hint ? `\nAdditional hint from the user: ${hint}\n` : '';
  return [
    'You are the pull-request assistant of a Git desktop client.',
    `Write the pull-request title and description in ${targetLanguage}.`,
    'The title must be a short summary (under 90 characters).',
    'The description must summarize the change and mention notable commits,',
    'in at most 12 markdown lines.',
    'Answer with exactly this format and nothing else:',
    'TITLE: <title>',
    'BODY: <description>',
    '--- commits in the pull request ---',
    commitLines || '(none)',
    hintLine,
    '--- diff ---',
    diff
  ].filter(Boolean).join('\n');
}

module.exports = { parseAiOutput, buildCommitPrompt, buildPrPrompt };
