const crypto = require('node:crypto');

function parseWorkingDiff(relativePath, staged, patch) {
  const binary = /^(?:GIT binary patch|Binary files .* differ)$/m.test(patch);
  const firstHunk = patch.search(/^@@ /m);
  const prelude = firstHunk === -1 ? patch : patch.slice(0, firstHunk);
  const hunks = [];
  if (firstHunk !== -1) {
    const source = patch.slice(firstHunk);
    const starts = [];
    const matcher = /^@@ /gm;
    let match;
    while ((match = matcher.exec(source))) starts.push(match.index);
    for (let index = 0; index < starts.length; index += 1) {
      const raw = source.slice(starts[index], starts[index + 1] ?? source.length);
      const [header = '', ...body] = raw.replace(/\n$/, '').split('\n');
      const range = header.match(
        /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
      );
      const id = crypto
        .createHash('sha256')
        .update(`${staged ? 'staged' : 'unstaged'}\0${relativePath}\0${raw}`)
        .digest('hex');
      hunks.push({
        id,
        header,
        oldRange: range
          ? { start: Number(range[1]), lines: Number(range[2] ?? 1) }
          : null,
        newRange: range
          ? { start: Number(range[3]), lines: Number(range[4] ?? 1) }
          : null,
        lines: body.map(line => ({
          type: line.startsWith('+')
            ? 'add'
            : line.startsWith('-')
              ? 'delete'
              : 'context',
          content: line
        })),
        raw
      });
    }
  }
  return { path: relativePath, staged, binary, hunks, prelude };
}

module.exports = { parseWorkingDiff };
