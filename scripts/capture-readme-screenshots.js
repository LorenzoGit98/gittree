/* global document */
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { createElectronFixture } = require('../test/helpers/electron-fixture');
const { git } = require('../test/helpers/git-repository');

const projectRoot = path.resolve(__dirname, '..');
const outputDirectory = path.join(projectRoot, 'docs', 'screenshots');

function writeFixtureFile(repository, relativePath, content) {
  const target = path.join(repository, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function createVisualHistory(repository) {
  git(repository, 'checkout', '-b', 'feature/fluid-workspace');
  writeFixtureFile(repository, 'src/workspace.js', 'module.exports = { fluid: true };\n');
  git(repository, 'add', 'src/workspace.js');
  git(repository, 'commit', '-m', 'Make repository switching feel instant');

  git(repository, 'checkout', 'main');
  writeFixtureFile(repository, 'docs/PERFORMANCE.md', '# Performance budgets\n\nMeasure before optimizing.\n');
  git(repository, 'add', 'docs/PERFORMANCE.md');
  git(repository, 'commit', '-m', 'Document performance budgets');
  git(repository, 'merge', '--no-ff', 'feature/fluid-workspace', '-m', 'Merge fluid workspace improvements');

  writeFixtureFile(repository, 'src/history.js', 'module.exports = { virtualized: true };\n');
  git(repository, 'add', 'src/history.js');
  git(repository, 'commit', '-m', 'Keep large histories responsive');
}

async function waitForVisualStability(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.allSettled(
      document.getAnimations().map(animation => animation.finished)
    );
  });
  await page.waitForTimeout(150);
}

async function captureScreenshots() {
  const fixture = createElectronFixture();
  let application;

  try {
    createVisualHistory(fixture.repository);
    fs.mkdirSync(outputDirectory, { recursive: true });

    application = await electron.launch({
      args: [
        projectRoot,
        '--force-device-scale-factor=1',
        `--user-data-dir=${fixture.userData}`,
        fixture.deepLink
      ],
      cwd: projectRoot
    });

    const page = await application.firstWindow();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('.repo-tab.active').waitFor({ timeout: 60000 });
    await page.locator('.graph-row').first().waitFor({ timeout: 60000 });
    await page.waitForFunction(() => (
      document.getElementById('workspace')?.dataset.loadState === 'settled'
    ), null, { timeout: 60000 });
    if (await page.locator('html').getAttribute('lang') !== 'en') {
      await page.evaluate(() => localStorage.setItem('gittree.language', 'en'));
      await page.reload();
      await page.locator('.repo-tab.active').waitFor({ timeout: 60000 });
      await page.locator('.graph-row').first().waitFor({ timeout: 60000 });
      await page.waitForFunction(() => (
        document.getElementById('workspace')?.dataset.loadState === 'settled'
      ), null, { timeout: 60000 });
    }
    await page.locator('.graph-row').first().click();
    await waitForVisualStability(page);

    await page.screenshot({
      path: path.join(outputDirectory, 'gittree-history-light.png'),
      animations: 'disabled'
    });

    await page.locator('#workspace .theme-toggle').click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await waitForVisualStability(page);
    await page.screenshot({
      path: path.join(outputDirectory, 'gittree-history-dark.png'),
      animations: 'disabled'
    });
  } finally {
    if (application) await application.close();
    fixture.cleanup();
  }
}

captureScreenshots().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
