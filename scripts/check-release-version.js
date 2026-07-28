const fs = require('node:fs');
const path = require('node:path');

const packagePath = path.resolve(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const tag = process.env.GITHUB_REF_NAME || process.argv[2] || '';

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version)) {
  throw new Error(`Invalid semantic version in package.json: ${packageJson.version}`);
}

if (tag && tag !== `v${packageJson.version}`) {
  throw new Error(`Release tag ${tag} does not match package version v${packageJson.version}`);
}

const missingOAuth = [
  ['GITTREE_GITHUB_CLIENT_ID', process.env.GITTREE_GITHUB_CLIENT_ID],
  ['GITTREE_GITLAB_CLIENT_ID', process.env.GITTREE_GITLAB_CLIENT_ID]
].filter(([, value]) => !value || !/^[A-Za-z0-9_.-]{6,200}$/.test(value));
if (missingOAuth.length) {
  throw new Error(
    `Production OAuth configuration is missing or invalid: ${
      missingOAuth.map(([name]) => name).join(', ')
    }`
  );
}

console.log(`Release version validated: v${packageJson.version}`);
