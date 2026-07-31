(function exposeConflictHighlight(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ConflictHighlight = api;
})(typeof window !== 'undefined' ? window : globalThis, function createConflictHighlight() {
  function splitLines(content) {
    return String(content || '').match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(Boolean) || [];
  }

  function classifyBlockLines(block, lines) {
    const kinds = new Map();
    const start = block.startLine;
    const end = block.endLine;
    kinds.set(start, 'marker');
    kinds.set(end, 'marker');
    if (start >= end || end > lines.length) return kinds;

    const hasBase = block.base !== null;
    let baseMarker = -1;
    let separator = -1;
    for (let index = start + 1; index < end; index += 1) {
      const line = lines[index - 1];
      if (baseMarker === -1 && separator === -1 && hasBase && /^\|\|\|\|\|\|\|(?:\s|$)/.test(line)) {
        baseMarker = index;
      } else if (separator === -1 && /^=======(?:\r?\n|\r)?$/.test(line)) {
        separator = index;
        break;
      }
    }
    if (separator === -1) return kinds;

    const currentEnd = baseMarker === -1 ? separator : baseMarker;
    for (let index = start + 1; index < currentEnd; index += 1) {
      kinds.set(index, 'current');
    }
    if (baseMarker !== -1) {
      kinds.set(baseMarker, 'marker');
      for (let index = baseMarker + 1; index < separator; index += 1) {
        kinds.set(index, 'base');
      }
    }
    kinds.set(separator, 'separator');
    for (let index = separator + 1; index < end; index += 1) {
      kinds.set(index, 'incoming');
    }
    return kinds;
  }

  function buildHighlightLines(content, blocks = []) {
    const lines = splitLines(content);
    const classification = new Map();
    for (const block of blocks || []) {
      for (const [lineNumber, kind] of classifyBlockLines(block, lines)) {
        classification.set(lineNumber, kind);
      }
    }
    return lines.map((line, index) => ({
      text: line.replace(/\r?\n|\r$/, ''),
      kind: classification.get(index + 1) || 'plain'
    }));
  }

  return { buildHighlightLines, countUnresolved: blocks => (blocks || []).length, splitLines };
});
