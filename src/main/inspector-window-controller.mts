function boundedString(value: unknown, maxLength: number, fallback = ''): string {
  return typeof value === 'string' && value.length <= maxLength ? value : fallback;
}

function boundedInteger(value: unknown, maximum: number, fallback = 0): number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= maximum ? value as number : fallback;
}

interface SanitizedParent {
  hash: string;
  lane: number;
  kind: string;
}

interface SanitizedRef {
  shortName: string;
  type: string;
}

interface SanitizedRow {
  hash: string;
  subject: string;
  lane: number;
  incoming: boolean;
  before: Array<string | null>;
  parents: SanitizedParent[];
  refs: SanitizedRef[];
}

interface GraphPayloadSource {
  revision?: unknown;
  laneCount?: unknown;
  hasMore?: unknown;
  selectedHash?: unknown;
  rows?: unknown;
}

function sanitizeGraphPayload(graph: GraphPayloadSource | null | undefined) {
  const rows: SanitizedRow[] = [];
  const rawRows = Array.isArray(graph?.rows) ? (graph.rows as unknown[]) : [];
  for (const source of rawRows.slice(0, 2000)) {
    const row = source as Record<string, unknown>;
    const hash = boundedString(row.hash, 80);
    if (!hash) continue;
    const before = Array.isArray(row.before) ? row.before as unknown[] : [];
    const parents = Array.isArray(row.parents) ? row.parents as unknown[] : [];
    const refs = Array.isArray(row.refs) ? row.refs as unknown[] : [];
    rows.push({
      hash,
      subject: boundedString(row.subject, 1000),
      lane: boundedInteger(row.lane, 127),
      incoming: row.incoming === true,
      before: before.slice(0, 128)
        .map(value => value == null ? null : boundedString(value, 80))
        .filter(value => value === null || Boolean(value)),
      parents: parents.slice(0, 128)
        .map((parent): SanitizedParent => {
          const entry = parent as { hash?: unknown; lane?: unknown; kind?: unknown };
          return {
            hash: boundedString(entry.hash, 80),
            lane: boundedInteger(entry.lane, 127),
            kind: ['first-parent', 'merge-parent'].includes(String(entry.kind))
              ? String(entry.kind)
              : 'first-parent'
          };
        })
        .filter(parent => parent.hash),
      refs: refs.slice(0, 64)
        .map((ref): SanitizedRef => {
          const entry = ref as { shortName?: unknown; type?: unknown };
          return {
            shortName: boundedString(entry.shortName, 500),
            type: ['branch', 'remote', 'tag', 'head'].includes(String(entry.type))
              ? String(entry.type)
              : 'branch'
          };
        })
        .filter(ref => ref.shortName)
    });
  }
  return {
    revision: boundedInteger(graph?.revision, Number.MAX_SAFE_INTEGER),
    laneCount: Math.max(1, boundedInteger(graph?.laneCount, 128, 1)),
    hasMore: graph?.hasMore === true,
    selectedHash: boundedString(graph?.selectedHash, 80) || null,
    rows
  };
}

function sanitizeFilesPayload(files: unknown) {
  return (Array.isArray(files) ? files : []).slice(0, 5000)
    .map((raw): Record<string, unknown> => {
      const file = raw as { path?: unknown; oldPath?: unknown; status?: unknown; additions?: unknown; deletions?: unknown };
      return {
        path: boundedString(file.path, 4000),
        oldPath: boundedString(file.oldPath, 4000) || null,
        status: ['A', 'D', 'M', 'R'].includes(String(file.status)) ? String(file.status) : 'M',
        additions: boundedInteger(file.additions, 10_000_000),
        deletions: boundedInteger(file.deletions, 10_000_000)
      };
    })
    .filter(file => file.path);
}

interface InspectorPayloadSource {
  title?: unknown;
  meta?: unknown;
  theme?: unknown;
  tone?: unknown;
  mode?: unknown;
  eyebrow?: unknown;
  modeLabel?: unknown;
  wordLevel?: unknown;
  graph?: GraphPayloadSource | null;
  files?: unknown;
  selectedFile?: unknown;
  filesOpen?: unknown;
  html?: unknown;
  diffText?: unknown;
}

function sanitizeInspectorPayload(payload: InspectorPayloadSource | null | undefined) {
  const theme = typeof payload?.theme === 'string' ? payload.theme : '';
  return {
    title: typeof payload?.title === 'string' && payload.title.length <= 200
      ? payload.title
      : 'Inspector',
    meta: typeof payload?.meta === 'string' && payload.meta.length <= 400
      ? payload.meta
      : '',
    theme: ['light', 'dark'].includes(theme) ? theme : 'light',
    tone: typeof payload?.tone === 'string' && /^[a-z]{1,32}$/.test(payload.tone)
      ? payload.tone
      : '',
    mode: payload?.mode === 'split' ? 'split' : 'unified',
    eyebrow: typeof payload?.eyebrow === 'string' && payload.eyebrow.length <= 80
      ? payload.eyebrow
      : 'Inspector',
    modeLabel: typeof payload?.modeLabel === 'string' && payload.modeLabel.length <= 80
      ? payload.modeLabel
      : (payload?.mode === 'split' ? 'Split' : 'Unified'),
    wordLevel: payload?.wordLevel === true,
    graph: sanitizeGraphPayload(payload?.graph),
    files: sanitizeFilesPayload(payload?.files),
    selectedFile: boundedString(payload?.selectedFile, 4000) || null,
    filesOpen: payload?.filesOpen !== false,
    html: typeof payload?.html === 'string' && payload.html.length <= 2_000_000
      ? payload.html
      : '',
    diffText: typeof payload?.diffText === 'string' && payload.diffText.length <= 10_000_000
      ? payload.diffText
      : ''
  };
}

interface BrowserWindowLike {
  isDestroyed(): boolean;
  focus(): void;
  loadFile(path: string): Promise<void>;
  destroy(): void;
  on(event: string, listener: () => void): unknown;
  webContents: { send(channel: string, payload: unknown): void; once(event: string, listener: () => void): unknown };
}

export interface InspectorWindowControllerOptions {
  BrowserWindow: new (options: Record<string, unknown>) => BrowserWindowLike;
  getMainWindow: () => BrowserWindowLike | null;
  lockDownWindow: (window: BrowserWindowLike) => void;
  iconPath: () => string;
  preloadPath: string;
  htmlPath: string;
  sendToRenderer: (channel: string, payload?: unknown) => void;
}

export function createInspectorWindowController({
  BrowserWindow,
  getMainWindow,
  lockDownWindow,
  iconPath,
  preloadPath,
  htmlPath,
  sendToRenderer
}: InspectorWindowControllerOptions) {
  let inspectorWindow: BrowserWindowLike | null = null;

  function open(payload: unknown) {
    const safePayload = sanitizeInspectorPayload(payload);
    if (inspectorWindow && !inspectorWindow.isDestroyed()) {
      inspectorWindow.focus();
      inspectorWindow.webContents.send('inspector:render', safePayload);
      return { success: true };
    }
    inspectorWindow = new BrowserWindow({
      width: 1040,
      height: 760,
      minWidth: 620,
      minHeight: 440,
      parent: getMainWindow(),
      title: safePayload.title,
      icon: iconPath(),
      backgroundColor: '#f7f9fc',
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    lockDownWindow(inspectorWindow);
    inspectorWindow.loadFile(htmlPath);
    inspectorWindow.webContents.once('did-finish-load', () => {
      inspectorWindow.webContents.send('inspector:render', safePayload);
    });
    inspectorWindow.on('closed', () => {
      inspectorWindow = null;
      sendToRenderer('inspector:closed');
    });
    return { success: true };
  }

  function update(payload: unknown) {
    if (!inspectorWindow || inspectorWindow.isDestroyed()) return { success: false };
    inspectorWindow.webContents.send('inspector:render', sanitizeInspectorPayload(payload));
    return { success: true };
  }

  function destroy() {
    if (inspectorWindow && !inspectorWindow.isDestroyed()) inspectorWindow.destroy();
    inspectorWindow = null;
  }

  return { open, update, destroy };
}
