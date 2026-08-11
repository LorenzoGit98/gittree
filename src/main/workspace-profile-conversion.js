const fs = require('node:fs');
const path = require('node:path');

function readPreviousWorkspace(fileSystem, configPath) {
  const source = fileSystem.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(source);
  if (!parsed || !Array.isArray(parsed.repos) || parsed.repos.length === 0) return null;
  return source;
}

function convertWorkspaceProfile({
  currentConfigPath,
  previousConfigPath,
  fileSystem = fs,
  processId = process.pid,
  timestamp = Date.now()
}) {
  if (fileSystem.existsSync(currentConfigPath)) return { converted: false };
  if (!previousConfigPath || path.resolve(previousConfigPath) === path.resolve(currentConfigPath)) {
    return { converted: false };
  }
  try {
    if (!fileSystem.existsSync(previousConfigPath)) return { converted: false };
    const source = readPreviousWorkspace(fileSystem, previousConfigPath);
    if (!source) return { converted: false };
    const directory = path.dirname(currentConfigPath);
    fileSystem.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${currentConfigPath}.${processId}.${timestamp}.conversion.tmp`;
    try {
      fileSystem.writeFileSync(temporaryPath, source, { flag: 'wx' });
      fileSystem.renameSync(temporaryPath, currentConfigPath);
    } finally {
      fileSystem.rmSync(temporaryPath, { force: true });
    }
    return { converted: true, source: previousConfigPath };
  } catch (error) {
    return { converted: false, error: error.message };
  }
}

module.exports = { convertWorkspaceProfile };
