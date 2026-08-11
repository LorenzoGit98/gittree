const bridge = window.gitTree;
const body = document.getElementById('inspector-body');
const title = document.getElementById('inspector-title');
const meta = document.getElementById('inspector-meta');
const eyebrow = document.getElementById('inspector-eyebrow');
const mode = document.getElementById('inspector-mode');
const word = document.getElementById('inspector-word');

bridge.onInspectorRender(payload => {
  if (payload.theme) {
    document.documentElement.dataset.theme = payload.theme;
  }
  if (payload.tone) {
    document.documentElement.dataset.tone = payload.tone;
  }
  document.title = payload.title || 'Inspector';
  title.textContent = payload.title || 'Inspector';
  title.title = title.textContent;
  meta.textContent = payload.meta || '';
  meta.classList.toggle('is-hidden', !payload.meta);
  eyebrow.textContent = payload.eyebrow || 'Inspector';
  mode.textContent = payload.modeLabel || (payload.mode === 'split' ? 'Split' : 'Unified');
  word.classList.toggle('is-hidden', !payload.wordLevel);

  if (payload.html) {
    body.innerHTML = payload.html;
  } else if (payload.diffText) {
    body.innerHTML = '';
    const pre = document.createElement('pre');
    pre.className = 'diff-raw';
    pre.textContent = payload.diffText;
    body.appendChild(pre);
  } else {
    body.innerHTML = '<div class="diff-placeholder"><span>No content</span></div>';
  }
});
