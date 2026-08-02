(function exposeWorkspacePanelMotion(root, factory) {
  const WorkspacePanelMotion = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = WorkspacePanelMotion;
  if (root) root.WorkspacePanelMotion = WorkspacePanelMotion;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createWorkspacePanelMotion() {
  return class WorkspacePanelMotion {
    constructor({ workspace, panels, document: documentRef, prefersReducedMotion = () => false }) {
      this.workspace = workspace;
      this.panels = panels;
      this.document = documentRef;
      this.prefersReducedMotion = prefersReducedMotion;
      this.active = new Map();
    }

    transition(name, { opening, animate = true, applyState }) {
      const config = this.panels[name];
      if (!config) return;
      this.cancel(name);

      if (!opening && config.panel.contains(this.document.activeElement)) {
        config.toggle.focus({ preventScroll: true });
      }

      applyState();
      config.panel.inert = !opening;
      config.panel.setAttribute('aria-hidden', String(!opening));

      if (!animate || this.prefersReducedMotion()) {
        config.panel.dataset.motionState = 'idle';
        return;
      }

      const direction = opening ? 'opening' : 'closing';
      const className = `is-${name}-${direction}`;
      const animationName = config[`${direction}Animation`];
      const finish = event => {
        if (event && (
          event.target !== config.panel ||
          event.animationName !== animationName
        )) return;
        this.cleanup(name);
      };

      this.workspace.classList.add(className);
      config.panel.dataset.motionState = direction;
      config.panel.addEventListener('animationend', finish);
      config.panel.addEventListener('animationcancel', finish);
      this.active.set(name, { className, finish });
    }

    cancel(name) {
      if (this.active.has(name)) this.cleanup(name);
    }

    cleanup(name) {
      const active = this.active.get(name);
      const config = this.panels[name];
      if (!active || !config) return;
      config.panel.removeEventListener('animationend', active.finish);
      config.panel.removeEventListener('animationcancel', active.finish);
      this.workspace.classList.remove(active.className);
      config.panel.dataset.motionState = 'idle';
      this.active.delete(name);
    }

    destroy() {
      for (const name of [...this.active.keys()]) this.cleanup(name);
    }
  };
});
