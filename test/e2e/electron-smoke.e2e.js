/* global CSSAnimation, document, getComputedStyle, MutationObserver, window */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { createElectronFixture } = require('../helpers/electron-fixture');

const projectRoot = path.resolve(__dirname, '..', '..');

async function capturePanelMotion(page, buttonId, panelId) {
  await page.locator(buttonId).click();
  return page.evaluate(id => {
    const panel = document.getElementById(id);
    const workspace = document.getElementById('workspace-body');
    const animation = panel.getAnimations().find(candidate => (
      candidate instanceof CSSAnimation && candidate.animationName.startsWith('motion-panel-')
    ));
    const keyframeProperties = animation
      ? [...new Set(animation.effect.getKeyframes().flatMap(keyframe => (
          Object.keys(keyframe).filter(key => ![
            'offset',
            'computedOffset',
            'easing',
            'composite'
          ].includes(key))
        )))]
      : [];
    return {
      animationName: animation?.animationName || '',
      keyframeProperties,
      workspaceTransitionProperty: getComputedStyle(workspace).transitionProperty
    };
  }, panelId);
}

test('Electron opens a deep-linked repository and renders its deterministic history', async t => {
  const fixture = createElectronFixture({ withRemote: true });
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
    await page.locator('.repo-tab.active').waitFor({ timeout: 60000 });
    await page.locator('.graph-row').first().waitFor({ timeout: 60000 });
    await page.waitForFunction(() => (
      document.getElementById('workspace')?.dataset.loadState === 'settled'
    ), null, { timeout: 60000 });

    assert.equal(await page.locator('.repo-tab.active').count(), 1);
    assert.equal(await page.locator('#workspace').getAttribute('aria-busy'), 'false');
    assert.match(
      await page.locator('.repo-tab.active .repo-tab-name').getAttribute('title'),
      /repo/i
    );
    assert.ok(await page.locator('.graph-row').count() < 100);
    assert.match(await page.locator('.graph-row').first().innerText(), /Initial fixture commit/);

    const panelMotions = [
      ['#btn-toggle-sidebar', 'sidebar', 'motion-panel-exit-left'],
      ['#btn-toggle-sidebar', 'sidebar', 'motion-panel-enter-left'],
      ['#btn-toggle-inspector', 'detail-panel', 'motion-panel-exit-right'],
      ['#btn-toggle-inspector', 'detail-panel', 'motion-panel-enter-right']
    ];
    for (const [buttonId, panelId, expectedName] of panelMotions) {
      const motion = await capturePanelMotion(page, buttonId, panelId);
      assert.equal(motion.animationName, expectedName);
      assert.deepEqual(motion.keyframeProperties.sort(), ['opacity', 'transform']);
      assert.equal(motion.workspaceTransitionProperty, 'none');
    }

    await page.locator('#branch-search').fill('feature');
    await page.getByText('feature/known-branch', { exact: true }).waitFor();

    await page.evaluate(() => {
      const telemetry = { openRepoCalls: 0, loadStates: [] };
      const implementation = window.app.openRepo.bind(window.app);
      window.app.openRepo = (...args) => {
        telemetry.openRepoCalls += 1;
        return implementation(...args);
      };
      new MutationObserver(() => {
        telemetry.loadStates.push(document.getElementById('workspace')?.dataset.loadState);
      }).observe(document.getElementById('workspace'), {
        attributes: true,
        attributeFilter: ['data-load-state']
      });
      window.__remoteActionTelemetry = telemetry;
      window.__remoteActionGraphRow = document.querySelector('.graph-row');
    });
    await page.locator('#btn-fetch').click();
    await page.waitForFunction(() => (
      document.getElementById('btn-fetch')?.getAttribute('aria-busy') === 'true'
    ));
    await page.waitForFunction(() => (
      document.getElementById('btn-fetch')?.getAttribute('aria-busy') === 'false'
    ));
    const remoteActionTelemetry = await page.evaluate(() => ({
      ...window.__remoteActionTelemetry,
      graphRowPreserved: document.querySelector('.graph-row') === window.__remoteActionGraphRow,
      branchFilter: document.getElementById('branch-search')?.value
    }));
    assert.equal(remoteActionTelemetry.openRepoCalls, 0);
    assert.equal(remoteActionTelemetry.loadStates.includes('loading'), false);
    assert.equal(remoteActionTelemetry.graphRowPreserved, true);
    assert.equal(remoteActionTelemetry.branchFilter, 'feature');
    await page.locator('#branch-search').fill('');

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

    await page.locator('[data-settings-close]').click();
    await page.evaluate(() => {
      window.__dialogResult = 'pending';
      window.app.dialogs.confirm({
        title: 'Accessibility contract',
        message: 'Keyboard cancellation must restore the workspace.',
        cancelLabel: 'Cancel',
        actionLabel: 'Continue'
      }).then(value => { window.__dialogResult = value; });
    });
    await page.getByRole('dialog', { name: 'Accessibility contract' }).waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__dialogResult === false);
    assert.equal(await page.getByRole('dialog').count(), 0);
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
