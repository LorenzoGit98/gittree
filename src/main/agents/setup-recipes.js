const fs = require('node:fs');
const path = require('node:path');

const RECIPES = Object.freeze([
  { files: ['bun.lock', 'bun.lockb'], id: 'bun-frozen', command: 'bun', args: ['install', '--frozen-lockfile'] },
  { files: ['pnpm-lock.yaml'], id: 'pnpm-frozen', command: 'pnpm', args: ['install', '--frozen-lockfile'] },
  { files: ['yarn.lock'], id: 'yarn-immutable', command: 'yarn', args: ['install', '--immutable'] },
  { files: ['package-lock.json', 'npm-shrinkwrap.json'], id: 'npm-ci', command: 'npm', args: ['ci'] }
]);

function detectSetupRecipe(directory, { fileSystem = fs } = {}) {
  for (const recipe of RECIPES) {
    if (recipe.files.some(file => fileSystem.existsSync(path.join(directory, file)))) {
      return { id: recipe.id, command: recipe.command, args: [...recipe.args] };
    }
  }
  return null;
}

module.exports = { RECIPES, detectSetupRecipe };

