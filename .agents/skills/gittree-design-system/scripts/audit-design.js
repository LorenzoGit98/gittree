const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..', '..', '..');
const rendererRoot = path.join(root, 'src', 'renderer');
const allowedExtensions = new Set(['.css', '.html', '.js']);
const violations = [];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function report(file, line, message) {
  violations.push(`${path.relative(root, file)}:${line} ${message}`);
}

for (const file of walk(rendererRoot).filter(file => allowedExtensions.has(path.extname(file)))) {
  const relative = path.relative(rendererRoot, file).replaceAll('\\', '/');
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

  lines.forEach((line, index) => {
    const number = index + 1;
    if (/backdrop-filter|filter\s*:\s*blur|mix-blend-mode/i.test(line)) {
      report(file, number, 'prohibited glass, blur, or blend effect');
    }
    if (/background(?:-color)?\s*:\s*(?:rgba|hsla|transparent)/i.test(line)) {
      report(file, number, 'functional backgrounds must use opaque semantic tokens');
    }
    if (/(?:linear|radial)-gradient/i.test(line) &&
        !(relative === 'styles/variables.css' && /--canvas-gradient/.test(line))) {
      report(file, number, 'gradients are allowed only in the --canvas-gradient token');
    }
    if (/#[0-9a-f]{3,8}\b/i.test(line) && relative !== 'styles/variables.css') {
      report(file, number, 'raw renderer color found outside variables.css');
    }
    if (/[⚠ℹ📁🏷⎇●○→]/u.test(line)) {
      report(file, number, 'replace Unicode pictograms with Phosphor icons');
    }
    if (/style\.cssText/.test(line)) {
      report(file, number, 'replace local cssText with shared component classes');
    }
    if (/style\s*=\s*["'](?!width:\$\{)/.test(line)) {
      report(file, number, 'replace static inline styles with shared classes');
    }
  });
}

const variables = fs.readFileSync(path.join(rendererRoot, 'styles', 'variables.css'), 'utf8');
for (const token of ['--canvas-gradient', '--surface-primary', '--primary', '--border-focus', '--radius-pill']) {
  if (!variables.includes(token)) violations.push(`styles/variables.css missing required token ${token}`);
}

if (violations.length) {
  console.error(`Design-system audit failed with ${violations.length} violation(s):`);
  violations.forEach(violation => console.error(`- ${violation}`));
  process.exit(1);
}

console.log('Design-system audit passed: opaque surfaces, scoped gradients, semantic colors, and icon rules are clean.');
