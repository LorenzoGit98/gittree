(function exposeDiffParser(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DiffParser = api;
})(typeof window !== 'undefined' ? window : globalThis, function createDiffParser() {
  function headerRange(line) {
    const match = String(line || '').match(
      /^@@@? -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@@?/
    );
    return match
      ? {
          oldStart: Number(match[1]),
          oldCount: Number(match[2] ?? 1),
          newStart: Number(match[3]),
          newCount: Number(match[4] ?? 1)
        }
      : null;
  }

  function metadataKind(line) {
    if (line.startsWith('diff --git')) return 'file';
    if (line.startsWith('@@')) return 'hunk';
    if (line === '\\ No newline at end of file') return 'no-newline';
    if (
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('new file') ||
      line.startsWith('deleted file') ||
      line.startsWith('similarity') ||
      line.startsWith('rename from ') ||
      line.startsWith('rename to ') ||
      line.startsWith('old mode ') ||
      line.startsWith('new mode ')
    ) return 'header';
    return null;
  }

  function parseUnified(patch) {
    let oldLine = null;
    let newLine = null;
    let inHunk = false;
    return String(patch || '').split('\n').map(content => {
      const metadata = metadataKind(content);
      if (metadata === 'hunk') {
        const range = headerRange(content);
        oldLine = range?.oldStart ?? null;
        newLine = range?.newStart ?? null;
        inHunk = Boolean(range);
        return { content, kind: 'hunk', oldLine: null, newLine: null };
      }
      if (metadata === 'file') {
        inHunk = false;
        return { content, kind: metadata, oldLine: null, newLine: null };
      }
      if (metadata === 'no-newline') {
        return { content, kind: metadata, oldLine: null, newLine: null };
      }
      if (!inHunk) {
        return { content, kind: metadata || 'header', oldLine: null, newLine: null };
      }
      if (content.startsWith('+')) {
        const row = { content, kind: 'add', oldLine: null, newLine };
        newLine += 1;
        return row;
      }
      if (content.startsWith('-')) {
        const row = { content, kind: 'del', oldLine, newLine: null };
        oldLine += 1;
        return row;
      }
      const row = { content, kind: 'context', oldLine, newLine };
      oldLine += 1;
      newLine += 1;
      return row;
    });
  }

  function emptySide() {
    return { content: '', kind: 'empty', oldLine: null, newLine: null };
  }

  function parseSplit(patch) {
    const output = [];
    let deletions = [];
    let additions = [];
    const flush = () => {
      const count = Math.max(deletions.length, additions.length);
      for (let index = 0; index < count; index += 1) {
        output.push({
          type: 'pair',
          left: deletions[index] || emptySide(),
          right: additions[index] || emptySide()
        });
      }
      deletions = [];
      additions = [];
    };

    for (const row of parseUnified(patch)) {
      if (row.kind === 'del') {
        deletions.push(row);
      } else if (row.kind === 'add') {
        additions.push(row);
      } else if (row.kind === 'context') {
        flush();
        output.push({ type: 'pair', left: row, right: row });
      } else {
        flush();
        output.push({ type: 'full', ...row });
      }
    }
    flush();
    return output;
  }

  function numberHunk(hunk) {
    let oldLine = hunk?.oldRange?.start ?? 0;
    let newLine = hunk?.newRange?.start ?? 0;
    return (hunk?.lines || []).map(sourceLine => {
      const content = typeof sourceLine === 'string'
        ? sourceLine
        : String(sourceLine?.content || '');
      const suppliedType = typeof sourceLine === 'object' ? sourceLine?.type : null;
      if (content === '\\ No newline at end of file') {
        return { ...sourceLine, content, kind: 'no-newline', oldLine: null, newLine: null };
      }
      const kind = suppliedType === 'delete' || content.startsWith('-')
        ? 'del'
        : suppliedType === 'add' || content.startsWith('+')
          ? 'add'
          : 'context';
      if (kind === 'add') {
        const row = { ...sourceLine, content, kind, oldLine: null, newLine };
        newLine += 1;
        return row;
      }
      if (kind === 'del') {
        const row = { ...sourceLine, content, kind, oldLine, newLine: null };
        oldLine += 1;
        return row;
      }
      const row = { ...sourceLine, content, kind, oldLine, newLine };
      oldLine += 1;
      newLine += 1;
      return row;
    });
  }

  function maxDigits(rows) {
    let maximum = 1;
    for (const row of rows || []) {
      const candidates = row.type === 'pair'
        ? [row.left?.oldLine, row.left?.newLine, row.right?.oldLine, row.right?.newLine]
        : [row.oldLine, row.newLine];
      for (const value of candidates) {
        if (Number.isInteger(value)) maximum = Math.max(maximum, String(value).length);
      }
    }
    return maximum;
  }

  return { headerRange, parseUnified, parseSplit, numberHunk, maxDigits };
});
