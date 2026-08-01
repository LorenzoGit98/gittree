const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const MINIMUM_GIT_VERSION = [2, 45, 1];

function parseGitVersion(output) {
  const match = String(output || '').match(/git version (\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
}

function isVersionAtLeast(version, minimum) {
  if (!Array.isArray(version) || version.length < 2) return false;
  for (let index = 0; index < minimum.length; index += 1) {
    const left = version[index] || 0;
    const right = minimum[index] || 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return true;
}

async function getGitVersion() {
  try {
    const { stdout } = await execFileAsync('git', ['--version'], { encoding: 'utf8' });
    const version = parseGitVersion(stdout);
    return {
      version: version ? version.join('.') : '',
      supported: version ? isVersionAtLeast(version, MINIMUM_GIT_VERSION) : false,
      minimum: MINIMUM_GIT_VERSION.join('.')
    };
  } catch {
    return { version: '', supported: false, minimum: MINIMUM_GIT_VERSION.join('.') };
  }
}

module.exports = {
  parseGitVersion,
  isVersionAtLeast,
  getGitVersion,
  MINIMUM_GIT_VERSION
};
