const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { collectReleaseAssets } = require('../scripts/release-assets');

test('Windows release assets include the installer, updater metadata and blockmap only', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gittree-release-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  [
    'GitTree-1.2.3-win-x64.exe',
    'GitTree-1.2.3-win-x64.exe.blockmap',
    'latest.yml',
    'builder-debug.yml',
    'notes.txt'
  ].forEach(name => fs.writeFileSync(path.join(directory, name), name));

  const assets = collectReleaseAssets('win', directory);

  assert.deepEqual(assets.map(asset => path.basename(asset)), [
    'GitTree-1.2.3-win-x64.exe',
    'GitTree-1.2.3-win-x64.exe.blockmap',
    'latest.yml'
  ]);
});

test('macOS release assets require ZIP update payloads and include DMG installers', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gittree-release-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  [
    'GitTree-1.2.3-mac-x64.dmg',
    'GitTree-1.2.3-mac-x64.zip',
    'GitTree-1.2.3-mac-x64.zip.blockmap',
    'latest-mac.yml'
  ].forEach(name => fs.writeFileSync(path.join(directory, name), name));

  const assets = collectReleaseAssets('mac', directory);

  assert.deepEqual(assets.map(asset => path.basename(asset)), [
    'GitTree-1.2.3-mac-x64.dmg',
    'GitTree-1.2.3-mac-x64.zip',
    'GitTree-1.2.3-mac-x64.zip.blockmap',
    'latest-mac.yml'
  ]);
});

test('Linux release assets include AppImage OTA payload, DEB and Pacman installers, and metadata', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gittree-release-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  [
    'GitTree-1.2.3-linux-x64.AppImage',
    'GitTree-1.2.3-linux-x64.AppImage.blockmap',
    'GitTree-1.2.3-linux-x64.deb',
    'GitTree-1.2.3-linux-x64.pacman',
    'latest-linux.yml'
  ].forEach(name => fs.writeFileSync(path.join(directory, name), name));

  const assets = collectReleaseAssets('linux', directory);

  assert.deepEqual(assets.map(asset => path.basename(asset)), [
    'GitTree-1.2.3-linux-x64.AppImage',
    'GitTree-1.2.3-linux-x64.AppImage.blockmap',
    'GitTree-1.2.3-linux-x64.deb',
    'GitTree-1.2.3-linux-x64.pacman',
    'latest-linux.yml'
  ]);
});

test('unsigned macOS releases expose DMG downloads without publishing a broken OTA feed', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gittree-release-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  [
    'GitTree-1.2.3-mac-x64.dmg',
    'GitTree-1.2.3-mac-x64.zip',
    'latest-mac.yml'
  ].forEach(name => fs.writeFileSync(path.join(directory, name), name));

  const assets = collectReleaseAssets('mac-manual', directory);

  assert.deepEqual(assets.map(asset => path.basename(asset)), [
    'GitTree-1.2.3-mac-x64.dmg'
  ]);
});
