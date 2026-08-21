/* exported ToastService */
class ToastService {
  /**
   * Owns the #toast element lifecycle: show/dismiss/pause/resume with
   * hover-pause semantics. Dependencies are injected; no global reads.
   * @param {{
   *   container?: HTMLElement,
   *   translate?: (key: string) => string,
   *   encode?: (value: unknown) => string,
   *   timers?: { setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout }
   * }} dependencies
   */
  constructor(dependencies = {}) {
    const {
      container,
      translate,
      encode,
      timers = { setTimeout, clearTimeout }
    } = dependencies || {};
    this.container = container;
    this.translate = translate || (key => key);
    this.encode = encode || (value => String(value ?? ''));
    this.timers = timers;
    this.timer = null;
    this.remaining = 0;
    this.startedAt = 0;

    this.handleMouseEnter = () => this.pause();
    this.handleMouseLeave = () => this.resume();
  }

  mount() {
    this.container.addEventListener('mouseenter', this.handleMouseEnter);
    this.container.addEventListener('mouseleave', this.handleMouseLeave);
  }

  show(message, type = '') {
    const kind = ['success', 'warning', 'error'].includes(type) ? type : 'loading';
    const icons = {
      loading: 'ph-circle-notch',
      success: 'ph-check-circle',
      warning: 'ph-warning',
      error: 'ph-x-circle'
    };
    const durations = { loading: 2500, success: 2800, warning: 4200, error: 5200 };
    const duration = durations[kind];

    this.timers.clearTimeout(this.timer);
    this.container.className = `toast toast-${kind} show`;
    this.container.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
    this.container.innerHTML =
      `<span class="toast-badge" aria-hidden="true"><i class="ph ${icons[kind]}"></i></span>` +
      `<span class="toast-message"></span>` +
      `<button type="button" class="toast-dismiss" aria-label="${this.encode(this.translate('common.close'))}"><i class="ph ph-x" aria-hidden="true"></i></button>` +
      `<span class="toast-progress" aria-hidden="true"></span>`;
    this.container.querySelector('.toast-message').textContent = message;
    const progress = /** @type {HTMLElement} */ (this.container.querySelector('.toast-progress'));
    progress.style.animationDuration = `${duration}ms`;
    const dismissButton = /** @type {HTMLElement} */ (this.container.querySelector('.toast-dismiss'));
    dismissButton.onclick = () => this.dismiss();

    this.remaining = duration;
    this.startedAt = Date.now();
    if (this.container.matches(':hover')) {
      this.container.classList.add('paused');
    } else {
      this.timer = this.timers.setTimeout(() => this.dismiss(), duration);
    }
  }

  dismiss() {
    this.timers.clearTimeout(this.timer);
    this.container.classList.remove('show');
  }

  pause() {
    if (!this.container.classList.contains('show') || this.container.classList.contains('paused')) return;
    this.timers.clearTimeout(this.timer);
    this.remaining = Math.max((this.remaining || 0) - (Date.now() - this.startedAt), 0);
    this.container.classList.add('paused');
  }

  resume() {
    if (!this.container.classList.contains('show') || !this.container.classList.contains('paused')) return;
    this.container.classList.remove('paused');
    this.startedAt = Date.now();
    this.timer = this.timers.setTimeout(() => this.dismiss(), Math.max(this.remaining, 800));
  }

  destroy() {
    this.timers.clearTimeout(this.timer);
    this.container.removeEventListener('mouseenter', this.handleMouseEnter);
    this.container.removeEventListener('mouseleave', this.handleMouseLeave);
  }
}

if (typeof module === 'object' && module.exports) module.exports = ToastService;
