const fs = require('node:fs');
const path = require('node:path');

function validClientId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{6,200}$/.test(value)
    ? value
    : '';
}

function loadOAuthConfig(app) {
  let packaged = {};
  if (app.isPackaged) {
    try {
      packaged = JSON.parse(
        fs.readFileSync(path.join(process.resourcesPath, 'oauth-config.json'), 'utf8')
      );
    } catch { /* packaged config is optional */ }
  }
  return {
    github: validClientId(
      process.env.GITTREE_GITHUB_CLIENT_ID || packaged.githubClientId
    ),
    gitlab: validClientId(
      process.env.GITTREE_GITLAB_CLIENT_ID || packaged.gitlabClientId
    )
  };
}

module.exports = {
  loadOAuthConfig,
  validClientId
};
