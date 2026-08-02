const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { createElectronFixture } = require('../helpers/electron-fixture');

const projectRoot = path.resolve(__dirname, '..', '..');

test('Electron opens a deep-linked repository and renders its deterministic history', async t => {
  const fixture = createElectronFixture();
  let application;
  let page;
  let failed = false;

  t.after(async () => {
    if (application) await application.close();
    fixture.cleanup();
  });

  try {
    application = await electron.launch({
      args: [
        projectRoot,
        `--user-data-dir=${fixture.userData}`,
        fixture.deepLink
      ],
      cwd: projectRoot
    });
    await application.context().tracing.start({ screenshots: true, snapshots: true });
    page = await application.firstWindow();
    await page.locator('.repo-tab.active').waitFor();
    await page.locator('.graph-row').first().waitFor();

    assert.equal(await page.locator('.repo-tab.active').count(), 1);
    assert.match(
      await page.locator('.repo-tab.active .repo-tab-name').getAttribute('title'),
      /repo/i
    );
    assert.ok(await page.locator('.graph-row').count() < 100);
    assert.match(await page.locator('.graph-row').first().innerText(), /Initial fixture commit/);

    await page.getByRole('tab', { name: /Changes|Modifiche/ }).click();
    await page.locator('#changes-view:not(.is-hidden)').waitFor();
    await page.getByText('dirty.txt', { exact: true }).waitFor();
    assert.match(await page.locator('#changes-view').innerText(), /dirty\.txt/);

    await page.locator('#btn-settings').click();
    const diagnosticsButton = page.getByRole('button', {
      name: /Export diagnostics|Esporta diagnostica/
    });
    await diagnosticsButton.waitFor();
    assert.equal(await diagnosticsButton.isEnabled(), true);
    await page.getByText(/privacy-redacted ZIP|ZIP anonimizzato/).waitFor();
  } catch (error) {
    failed = true;
    const artifactDirectory = path.join(projectRoot, 'test-results', 'electron-smoke');
    fs.mkdirSync(artifactDirectory, { recursive: true });
    if (page) {
      await page.screenshot({
        path: path.join(artifactDirectory, 'failure.png'),
        fullPage: true
      }).catch(() => {});
    }
    if (application) {
      await application.context().tracing.stop({
        path: path.join(artifactDirectory, 'trace.zip')
      }).catch(() => {});
    }
    throw error;
  } finally {
    if (!failed && application) await application.context().tracing.stop();
  }
});
