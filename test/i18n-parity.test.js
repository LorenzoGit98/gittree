const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const i18nSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'i18n.js'),
  'utf8'
);

function extractResources() {
  const marker = 'resources: {';
  const start = i18nSource.indexOf(marker) + marker.length - 1;
  let depth = 0;
  let end = -1;
  for (let index = start; index < i18nSource.length; index += 1) {
    const char = i18nSource[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }
  if (end === -1) throw new Error('resources literal not found in i18n.js');
  const literal = i18nSource.slice(start, end);
  return Function(`"use strict"; return (${literal});`)();
}

function keySet(object, prefix = '', keys = new Set()) {
  for (const [key, value] of Object.entries(object || {})) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keySet(value, fullKey, keys);
    } else {
      keys.add(fullKey);
    }
  }
  return keys;
}

test('English and Italian translations expose the same key sets', () => {
  const resources = extractResources();
  assert.ok(resources, 'resources object could not be extracted from i18n.js');
  const en = keySet(resources.en?.translation);
  const it = keySet(resources.it?.translation);

  const missingInItalian = [...en].filter(key => !it.has(key));
  const extraInItalian = [...it].filter(key => !en.has(key));

  assert.deepEqual(
    missingInItalian,
    [],
    `Keys missing from the Italian translation: ${missingInItalian.join(', ')}`
  );
  assert.deepEqual(
    extraInItalian,
    [],
    `Keys present only in Italian: ${extraInItalian.join(', ')}`
  );
});
