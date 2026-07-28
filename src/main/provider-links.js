function parseRemoteUrl(remoteUrl) {
  if (typeof remoteUrl !== 'string' || !remoteUrl.trim()) return null;

  const value = remoteUrl.trim();
  let host;
  let repositoryPath;

  const scpMatch = value.match(/^(?:[^@]+@)?([^:]+):(.+)$/);
  if (scpMatch && !value.includes('://')) {
    host = scpMatch[1];
    repositoryPath = scpMatch[2];
  } else {
    try {
      const parsed = new URL(value);
      host = parsed.hostname;
      repositoryPath = parsed.pathname.replace(/^\/+/, '');
    } catch {
      return null;
    }
  }

  repositoryPath = repositoryPath.replace(/\.git$/i, '').replace(/\/+$/, '');
  const normalizedHost = host.toLowerCase();
  const segments = repositoryPath.split('/').filter(Boolean);
  if (!host || segments.length < 2) return null;

  const azureSsh = ['ssh.dev.azure.com', 'vs-ssh.visualstudio.com'].includes(normalizedHost);
  const azureCloud = normalizedHost === 'dev.azure.com';
  const azureLegacy = normalizedHost.endsWith('.visualstudio.com')
    && normalizedHost !== 'vs-ssh.visualstudio.com';
  if (azureSsh || azureCloud || azureLegacy) {
    let organization;
    let project;
    let repository;
    if (azureSsh && segments[0]?.toLowerCase() === 'v3') {
      [, organization, project, repository] = segments;
    } else if (azureCloud) {
      [organization, project] = segments;
      const gitIndex = segments.findIndex(segment => segment.toLowerCase() === '_git');
      repository = gitIndex >= 0 ? segments[gitIndex + 1] : null;
    } else {
      organization = normalizedHost.slice(0, -'.visualstudio.com'.length);
      [project] = segments;
      const gitIndex = segments.findIndex(segment => segment.toLowerCase() === '_git');
      repository = gitIndex >= 0 ? segments[gitIndex + 1] : null;
    }
    if (!organization || !project || !repository) return null;
    return {
      provider: 'azure',
      host: normalizedHost,
      ownerPath: `${organization}/${project}`,
      repository,
      organization,
      project,
      webBase: `https://dev.azure.com/${organization}/${project}/_git/${repository}`
    };
  }

  const repository = segments.pop();
  const ownerPath = segments.join('/');
  let provider = null;
  if (normalizedHost.includes('github')) provider = 'github';
  else if (normalizedHost.includes('gitlab')) provider = 'gitlab';
  else if (normalizedHost === 'bitbucket.org' || normalizedHost.includes('bitbucket')) provider = 'bitbucket';

  return {
    provider,
    host: normalizedHost,
    ownerPath,
    repository,
    webBase: `https://${normalizedHost}/${ownerPath}/${repository}`
  };
}

function buildPullRequestUrl(remote, sourceBranch, targetBranch) {
  if (!remote?.provider || !sourceBranch || !targetBranch) return null;

  const source = encodeURIComponent(sourceBranch);
  const target = encodeURIComponent(targetBranch);
  if (remote.provider === 'github') {
    return `${remote.webBase}/compare/${target}...${source}?expand=1`;
  }
  if (remote.provider === 'gitlab') {
    return `${remote.webBase}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${source}&merge_request%5Btarget_branch%5D=${target}`;
  }
  if (remote.provider === 'bitbucket') {
    return `${remote.webBase}/pull-requests/new?source=${source}&dest=${target}`;
  }
  if (remote.provider === 'azure') {
    return `${remote.webBase}/pullrequestcreate?sourceRef=${source}&targetRef=${target}`;
  }
  return null;
}

module.exports = {
  parseRemoteUrl,
  buildPullRequestUrl
};
