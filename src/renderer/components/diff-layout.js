(function exposeDiffLayout(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DiffLayout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createDiffLayout() {
  function groupRows(rows, { isFile, pathForFile = () => null } = {}) {
    const files = [];
    let current = null;
    for (const row of rows || []) {
      if (isFile?.(row)) {
        current = { header: row, path: pathForFile(row), rows: [] };
        files.push(current);
      } else {
        if (!current) {
          current = { header: null, path: null, rows: [] };
          files.push(current);
        }
        current.rows.push(row);
      }
    }
    return files;
  }

  function layoutFiles(files, {
    rowHeight = 22,
    headerHeight = 36,
    fileGap = 12
  } = {}) {
    let top = 0;
    const layout = (files || []).map((file, index) => {
      const rows = Array.isArray(file.rows) ? file.rows : [];
      const contentTop = file.header ? headerHeight : 0;
      const height = contentTop + rows.length * rowHeight;
      const result = {
        ...file,
        rows,
        top,
        height,
        contentTop,
        rowHeight,
        end: top + height
      };
      top += height + (index < files.length - 1 ? fileGap : 0);
      return result;
    });
    return { files: layout, totalHeight: top };
  }

  function visibleFiles(files, scrollTop, viewportHeight, overscan = 220) {
    const currentTop = Number(scrollTop) || 0;
    const start = Math.max(0, currentTop - overscan);
    const end = Math.max(start, currentTop + viewportHeight + overscan);
    return (files || []).filter(file => file.end >= start && file.top <= end);
  }

  return { groupRows, layoutFiles, visibleFiles };
});
