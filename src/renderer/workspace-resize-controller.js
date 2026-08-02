(function exposeWorkspaceResizeController(root, factory) {
  const WorkspaceResizeController = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = WorkspaceResizeController;
  }
  if (root) root.WorkspaceResizeController = WorkspaceResizeController;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createWorkspaceResizeController() {
  return class WorkspaceResizeController {
    constructor({
      workspace,
      panels,
      document: documentRef,
      storage,
      requestFrame,
      cancelFrame
    }) {
      this.workspace = workspace;
      this.panels = panels;
      this.document = documentRef;
      this.storage = storage;
      this.requestFrame = requestFrame;
      this.cancelFrame = cancelFrame;
      this.bindings = new Map();
      this.active = null;
    }

    mount() {
      for (const [name, config] of Object.entries(this.panels)) {
        this.restore(config);
        const onPointerDown = event => this.start(name, config, event);
        config.handle.addEventListener('pointerdown', onPointerDown);
        this.bindings.set(name, onPointerDown);
      }
    }

    restore(config) {
      const savedWidth = Number(this.storage.getItem(config.storageKey));
      if (Number.isFinite(savedWidth) && savedWidth > 0) {
        this.workspace.style.setProperty(config.cssVariable, `${savedWidth}px`);
      }
    }

    start(name, config, event) {
      if (event.button != null && event.button !== 0) return;
      if (this.active) this.finish(this.active.latestX, false);
      event.preventDefault();

      const active = {
        name,
        config,
        startX: event.clientX,
        latestX: event.clientX,
        startWidth: config.panel.getBoundingClientRect().width,
        paintedWidth: null,
        frame: 0
      };
      active.onMove = moveEvent => this.move(active, moveEvent);
      active.onUp = upEvent => this.finishPointer(active, upEvent, true);
      active.onCancel = cancelEvent => this.finishPointer(active, cancelEvent, false);
      this.active = active;

      config.handle.classList.add('is-dragging');
      this.workspace.classList.add('is-resizing');
      this.document.body.style.cursor = 'col-resize';
      if (event.isTrusted) config.handle.setPointerCapture?.(event.pointerId);

      this.document.addEventListener('pointermove', active.onMove);
      this.document.addEventListener('pointerup', active.onUp);
      this.document.addEventListener('pointercancel', active.onCancel);
    }

    move(active, event) {
      if (this.active !== active) return;
      active.latestX = event.clientX;
      if (!active.frame) {
        active.frame = this.requestFrame(() => {
          active.frame = 0;
          if (this.active === active) this.paint(active);
        });
      }
    }

    calculateWidth(active, clientX) {
      const { config, startWidth, startX } = active;
      const width = startWidth + ((clientX - startX) * config.direction);
      return Math.round(Math.min(config.max, Math.max(config.min, width)));
    }

    paint(active) {
      const width = this.calculateWidth(active, active.latestX);
      if (width === active.paintedWidth) return width;
      active.paintedWidth = width;
      this.workspace.style.setProperty(active.config.cssVariable, `${width}px`);
      return width;
    }

    finishPointer(active, event, persist) {
      const clientX = Number.isFinite(event.clientX) ? event.clientX : active.latestX;
      this.finish(clientX, persist);
    }

    finish(clientX, persist) {
      const active = this.active;
      if (!active) return;
      active.latestX = clientX;
      if (active.frame) {
        this.cancelFrame(active.frame);
        active.frame = 0;
      }
      const width = this.paint(active);
      if (persist) this.storage.setItem(active.config.storageKey, String(width));
      this.cleanup(active);
    }

    cleanup(active) {
      this.document.removeEventListener('pointermove', active.onMove);
      this.document.removeEventListener('pointerup', active.onUp);
      this.document.removeEventListener('pointercancel', active.onCancel);
      active.config.handle.classList.remove('is-dragging');
      this.workspace.classList.remove('is-resizing');
      this.document.body.style.cursor = '';
      if (this.active === active) this.active = null;
    }

    destroy() {
      if (this.active) {
        const active = this.active;
        if (active.frame) this.cancelFrame(active.frame);
        this.cleanup(active);
      }
      for (const [name, listener] of this.bindings) {
        this.panels[name].handle.removeEventListener('pointerdown', listener);
      }
      this.bindings.clear();
    }
  };
});
