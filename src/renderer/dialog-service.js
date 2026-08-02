(function exposeDialogService(root, factory) {
  const DialogService = factory();
  if (typeof module === 'object' && module.exports) module.exports = DialogService;
  if (root) root.DialogService = DialogService;
})(typeof window !== 'undefined' ? window : globalThis, function createDialogService() {
  let nextDialogId = 1;

  class DialogService {
    constructor(options = {}) {
      this.document = options.document || document;
      this.overlay = options.overlay || this.document.getElementById('modal-overlay');
      this.dialog = options.dialog || this.document.getElementById('modal-dialog');
      this.encode = options.encode || (value => HtmlEncoder.encode(value));
      this.activeCancel = null;
    }

    confirm({ title, message, cancelLabel, actionLabel, danger = false }) {
      const id = `dialog-title-${nextDialogId++}`;
      return this.open({
        markup: `<h3 id="${id}">${this.encode(title)}</h3><p>${this.encode(message)}</p>
          <div class="confirm-actions">
            <button class="btn" type="button" data-cancel>${this.encode(cancelLabel)}</button>
            <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" data-confirm>${this.encode(actionLabel)}</button>
          </div>`,
        titleId: id,
        cancelValue: false,
        bind: finish => {
          this.dialog.querySelector('[data-confirm]').onclick = () => finish(true);
        }
      });
    }

    prompt({ title, label, value = '', cancelLabel, actionLabel, maxLength = 1000 }) {
      const safeMaxLength = Math.max(1, Math.min(65536, Number(maxLength) || 1000));
      return this.form({
        title,
        fields: `<label>${this.encode(label)}
          <input name="value" value="${this.encode(value)}" maxlength="${safeMaxLength}" required autofocus>
        </label>`,
        cancelLabel,
        actionLabel,
        extract: form => form.elements.value.value
      });
    }

    form({ title, fields, extract, cancelLabel, actionLabel, danger = false }) {
      const id = `dialog-title-${nextDialogId++}`;
      return this.open({
        markup: `<form class="branch-dialog-form">
          <h3 id="${id}">${this.encode(title)}</h3>${fields}
          <div class="confirm-actions">
            <button class="btn" type="button" data-cancel>${this.encode(cancelLabel)}</button>
            <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="submit">${this.encode(actionLabel)}</button>
          </div>
        </form>`,
        titleId: id,
        cancelValue: null,
        bind: finish => {
          this.dialog.querySelector('form').onsubmit = event => {
            event.preventDefault();
            finish(extract(event.currentTarget));
          };
        }
      });
    }

    open({ markup, titleId, cancelValue, bind }) {
      if (this.activeCancel) this.activeCancel();
      const previousFocus = this.document.activeElement;
      this.dialog.className = 'confirm-dialog';
      this.dialog.innerHTML = markup;
      this.dialog.setAttribute('role', 'dialog');
      this.dialog.setAttribute('aria-modal', 'true');
      this.dialog.setAttribute('aria-labelledby', titleId);
      this.overlay.classList.remove('is-hidden');

      return new Promise(resolve => {
        let finished = false;
        const finish = value => {
          if (finished) return;
          finished = true;
          this.document.removeEventListener('keydown', onKeydown);
          this.overlay.onclick = null;
          this.overlay.classList.add('is-hidden');
          this.dialog.innerHTML = '';
          this.dialog.removeAttribute('role');
          this.dialog.removeAttribute('aria-modal');
          this.dialog.removeAttribute('aria-labelledby');
          this.activeCancel = null;
          if (previousFocus?.isConnected) previousFocus.focus();
          resolve(value);
        };
        const onKeydown = event => {
          if (event.key === 'Escape') {
            event.preventDefault();
            finish(cancelValue);
            return;
          }
          if (event.key !== 'Tab') return;
          const focusable = [...this.dialog.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
          )];
          if (!focusable.length) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && this.document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && this.document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        };
        this.activeCancel = () => finish(cancelValue);
        this.document.addEventListener('keydown', onKeydown);
        this.overlay.onclick = event => {
          if (event.target === this.overlay) finish(cancelValue);
        };
        this.dialog.querySelector('[data-cancel]').onclick = () => finish(cancelValue);
        bind(finish);
        this.dialog.querySelector('[autofocus], input, select, textarea, [data-confirm]')?.focus();
      });
    }
  }

  return DialogService;
});
