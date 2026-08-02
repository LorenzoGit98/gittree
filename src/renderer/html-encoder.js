(function exposeHtmlEncoder(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HtmlEncoder = api;
})(typeof window !== 'undefined' ? window : globalThis, function createHtmlEncoder() {
  const entities = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };

  function encode(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => entities[character]);
  }

  return Object.freeze({ encode });
});
