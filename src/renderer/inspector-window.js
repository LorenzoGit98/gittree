const bridge = window.gitTree;
const body = document.getElementById('inspector-body');

bridge.onInspectorRender(payload => {
  if (payload.theme) {
    document.documentElement.dataset.theme = payload.theme;
  }
  if (payload.tone) {
    document.documentElement.dataset.tone = payload.tone;
  }
  document.title = payload.title || 'Inspector';

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
