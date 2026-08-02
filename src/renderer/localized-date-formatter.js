(function exposeLocalizedDateFormatter(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LocalizedDateFormatter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createModule() {
  const options = { dateStyle: 'short', timeStyle: 'short' };

  function create({ DateTimeFormat = Intl.DateTimeFormat } = {}) {
    let activeLanguage = null;
    let formatter = null;

    return (value, language) => {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return date.toLocaleString(language, options);
      if (!formatter || activeLanguage !== language) {
        activeLanguage = language;
        formatter = new DateTimeFormat(language, options);
      }
      return formatter.format(date);
    };
  }

  return { create };
});
