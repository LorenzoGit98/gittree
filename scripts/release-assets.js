const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PLATFORM_RULES = {
  win: {
    package: name => /^GitTree-.+-win-.+\.exe$/i.test(name),
    metadata: name => /^(?:latest|beta|alpha)\.yml$/i.test(name),
    optional: name => /^GitTree-.+-win-.+\.exe\.blockmap$/i.test(name),
    required: [
      { label: 'NSIS installer', matches: name => /^GitTree-.+-win-.+\.exe$/i.test(name) }
    ]
  },
  mac: {
    package: name => /^GitTree-.+-mac-.+\.(?:dmg|zip)$/i.test(name),
    metadata: name => /^(?:latest|beta|alpha)-mac\.yml$/i.test(name),
    optional: name => /^GitTree-.+-mac-.+\.zip\.blockmap$/i.test(name),
    required: [
      { label: 'DMG installer', matches: name => /^GitTree-.+-mac-.+\.dmg$/i.test(name) },
      { label: 'ZIP update payload', matches: name => /^GitTree-.+-mac-.+\.zip$/i.test(name) }
    ]
  },
  'mac-manual': {
    package: name => /^GitTree-.+-mac-.+\.dmg$/i.test(name),
    metadata: null,
    optional: () => false,
    requiresMetadata: false,
    required: [
      { label: 'DMG installer', matches: name => /^GitTree-.+-mac-.+\.dmg$/i.test(name) }
    ]
  },
  linux: {
    package: name => /^GitTree-.+-linux-.+\.(?:AppImage|deb)$/i.test(name),
    metadata: name => /^(?:latest|beta|alpha)-linux\.yml$/i.test(name),
    optional: name => /^GitTree-.+-linux-.+\.AppImage\.blockmap$/i.test(name),
    required: [
      { label: 'AppImage update payload', matches: name => /^GitTree-.+-linux-.+\.AppImage$/i.test(name) },
      { label: 'DEB installer', matches: name => /^GitTree-.+-linux-.+\.deb$/i.test(name) }
    ]
  }
};

function collectReleaseAssets(platform, directory) {
  const rules = PLATFORM_RULES[platform];
  if (!rules) throw new Error(`Unsupported release platform: ${platform}`);
  const resolvedDirectory = path.resolve(directory);
  const stats = fs.statSync(resolvedDirectory);
  if (!stats.isDirectory()) throw new Error(`Release asset directory is not a directory: ${resolvedDirectory}`);

  const files = fs.readdirSync(resolvedDirectory, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name);
  const packages = files.filter(rules.package);
  const metadata = rules.metadata ? files.filter(rules.metadata) : [];
  const optional = files.filter(rules.optional);
  for (const requirement of rules.required) {
    if (!files.some(requirement.matches)) {
      throw new Error(`Missing ${platform} release asset: ${requirement.label}`);
    }
  }
  if (rules.requiresMetadata !== false && !metadata.length) {
    throw new Error(`No ${platform} updater metadata found`);
  }
  return [...packages, ...optional, ...metadata]
    .sort((left, right) => left.localeCompare(right))
    .map(name => path.join(resolvedDirectory, name));
}

function parseArguments(argv) {
  const result = { platform: '', directory: 'dist', tag: '', dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--dry-run') result.dryRun = true;
    else if (value === '--platform') result.platform = argv[++index] || '';
    else if (value === '--directory') result.directory = argv[++index] || '';
    else if (value === '--tag') result.tag = argv[++index] || '';
    else throw new Error(`Unknown argument: ${value}`);
  }
  return result;
}

function run(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(options.tag)) {
    throw new Error(`Invalid release tag: ${options.tag}`);
  }
  const assets = collectReleaseAssets(options.platform, options.directory);
  if (options.dryRun) {
    process.stdout.write(`${assets.join('\n')}\n`);
    return assets;
  }
  const result = spawnSync(
    'gh',
    ['release', 'upload', options.tag, ...assets, '--clobber'],
    { stdio: 'inherit' }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`GitHub release upload failed with exit code ${result.status}`);
  return assets;
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { collectReleaseAssets, parseArguments, run };
