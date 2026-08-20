// @ts-check
'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

/**
 * A Git version as `[major, minor, patch]` numeric components.
 * @typedef {[number, number, number]} GitVersionTriple
 */

/**
 * Result of a `git --version` probe.
 * @typedef {object} GitVersionInfo
 * @property {string} version dotted Git version, empty when Git is unavailable.
 * @property {boolean} supported whether the detected version meets the minimum.
 * @property {string} minimum the minimum supported dotted version.
 */

const MINIMUM_GIT_VERSION = /** @type {GitVersionTriple} */ ([2, 45, 1]);

/**
 * Parse the output of `git --version` into numeric components.
 * @param {unknown} output raw command output or any fallback value.
 * @returns {GitVersionTriple | null} `[major, minor, patch]`, or `null` when
 *   the output does not contain a recognizable `git version` string.
 */
function parseGitVersion(output) {
  const match = String(output || '').match(/git version (\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
}

/**
 * Compare a parsed version against a minimum, component by component.
 * @param {unknown} version candidate version components.
 * @param {readonly number[]} minimum minimum version components.
 * @returns {boolean} `true` when `version` is greater than or equal to
 *   `minimum`; malformed candidates are never supported.
 */
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

/**
 * Detect the installed Git version and whether it is supported.
 * @returns {Promise<GitVersionInfo>} probe result; an unavailable or
 *   unparsable Git yields an empty version and `supported: false`.
 */
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
