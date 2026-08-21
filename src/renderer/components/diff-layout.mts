export interface DiffRow {
  [key: string]: unknown;
}

export interface FileGroup {
  header: DiffRow | null;
  path: string | null;
  rows: DiffRow[];
}

export interface LayoutFile extends FileGroup {
  top: number;
  height: number;
  contentTop: number;
  rowHeight: number;
  end: number;
}

export function groupRows(rows: unknown, { isFile, pathForFile = () => null }: { isFile?: (row: DiffRow) => boolean; pathForFile?: (row: DiffRow) => string | null } = {}): FileGroup[] {
  const files: FileGroup[] = [];
  let current: FileGroup | null = null;
  for (const row of (rows ?? []) as DiffRow[]) {
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

export function layoutFiles(files: unknown, {
  rowHeight = 22,
  headerHeight = 36,
  fileGap = 12
}: { rowHeight?: number; headerHeight?: number; fileGap?: number } = {}): { files: LayoutFile[]; totalHeight: number } {
  let top = 0;
  const layout: LayoutFile[] = ((files ?? []) as FileGroup[]).map((file, index) => {
    const rows = Array.isArray(file.rows) ? file.rows : [];
    const contentTop = file.header ? headerHeight : 0;
    const height = contentTop + rows.length * rowHeight;
    const result: LayoutFile = {
      ...file,
      rows,
      top,
      height,
      contentTop,
      rowHeight,
      end: top + height
    };
    top += height + (index < (files as FileGroup[]).length - 1 ? fileGap : 0);
    return result;
  });
  return { files: layout, totalHeight: top };
}

export function visibleFiles(files: unknown, scrollTop: unknown, viewportHeight: unknown, overscan = 220): LayoutFile[] {
  const currentTop = Number(scrollTop) || 0;
  const start = Math.max(0, currentTop - overscan);
  const end = Math.max(start, currentTop + (Number(viewportHeight) || 0) + overscan);
  return ((files ?? []) as LayoutFile[]).filter(file => file.end >= start && file.top <= end);
}

export const DiffLayout = {
  groupRows,
  layoutFiles,
  visibleFiles
};

if (typeof window !== 'undefined') {
  (window as unknown as { DiffLayout: typeof DiffLayout }).DiffLayout = DiffLayout;
}

declare const module: { exports: unknown } | undefined;
if (typeof module !== 'undefined' && (module as { exports?: unknown }).exports) {
  (module as { exports: unknown }).exports = DiffLayout;
}
