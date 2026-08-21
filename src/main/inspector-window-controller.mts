function boundedString(value: unknown, maxLength: number, fallback = ''): string {
  return typeof value === 'string' && value.length <= maxLength ? value : fallback;
}

function boundedInteger(value: unknown, maximum: number, fallback = 0): number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= maximum ? value as number : fallback;
}

export function sanitizeGraphPayload(graph: any) {
  const rows: any[] = [];
  for (const source of Array.isArray(graph?.rows) ? (graph.rows as any[]).slice(0, 2000) : []) {
    const hash = boundedString(source?.hash, 80);
    if (!hash) continue;
    rows.push({
      hash,
      subject: boundedString(source.subject, 1000),
      lane: boundedInteger(source.lane, 127),
      incoming: source.incoming === true,
      before: (Array.isArray(source.before) ? source.before : []).slice(0, 128)
        .map(value => value == null ? null : boundedString(value, 80))
        .filter(value => value === null || Boolean(value)),
      parents: (Array.isArray(source.parents) ? source.parents : []).slice(0, 128)
        .map(parent => ({
          hash: boundedString((parent as any)?.hash, 80),
          lane: boundedInteger((parent as any)?.lane, 127),
          kind: ['first-parent', 'merge-parent'].includes((parent as any)?.kind)
            ? (parent as any).kind
            : 'first-parent'
        }))
        .filter(parent => parent.hash),
      refs: (Array.isArray(source.refs) ? source.refs : []).slice(0, 64)
        .map(ref => ({
          shortName: boundedString((ref as any)?.shortName, 500),
          type: ['branch', 'remote', 'tag', 'head'].includes((ref as any)?.type)
            ? (ref as any).type
            : 'branch'
        }))
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
    .map(file => ({
      path: boundedString((file as any)?.path, 4000),
      oldPath: boundedString((file as any)?.oldPath, 4000) || null,
      status: ['A', 'D', 'M', 'R'].includes((file as any)?.status) ? (file as any).status : 'M',
      additions: boundedInteger((file as any)?.additions, 10_000_000),
      deletions: boundedInteger((file as any)?.deletions, 10_000_000)
    }))
    .filter(file => file.path);
}

export function sanitizeInspectorPayload(payload: any) {
  return {
    title: typeof payload?.title === 'string' && payload.title.length <= 200
      ? payload.title
      : 'Inspector',
    meta: typeof payload?.meta === 'string' && payload.meta.length <= 400
      ? payload.meta
      : '',
    theme: ['light', 'dark'].includes(payload?.theme) ? payload.theme : 'light',
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

export interface InspectorWindowControllerOptions {
  BrowserWindow: any;
  getMainWindow: () => any;
  lockDownWindow: (window: any) => void;
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
  let inspectorWindow: any | null = null;

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
