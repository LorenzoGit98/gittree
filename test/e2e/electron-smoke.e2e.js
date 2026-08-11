/* global document, getComputedStyle, MutationObserver, window */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { createElectronFixture } = require('../helpers/electron-fixture');

const projectRoot = path.resolve(__dirname, '..', '..');

async function capturePanelMotion(page, buttonId, panelId, expectedAnimationName, expectedClass) {
  await page.evaluate(({ id, expectedName, lifecycleClass }) => {
    const panel = document.getElementById(id);
    const workspace = document.getElementById('workspace-body');
    window.__panelMotionCapture = null;
    const observer = new MutationObserver(() => {
      if (!workspace.classList.contains(lifecycleClass)) return;
      const animationNames = getComputedStyle(panel).animationName.split(',').map(value => value.trim());
      window.__panelMotionCapture = {
        animationName: animationNames.includes(expectedName) ? expectedName : animationNames.join(','),
        lifecycleClass,
        motionState: panel.dataset.motionState,
        workspaceTransitionProperty: getComputedStyle(workspace).transitionProperty
      };
      observer.disconnect();
    });
    observer.observe(workspace, { attributes: true, attributeFilter: ['class'] });
  }, { id: panelId, expectedName: expectedAnimationName, lifecycleClass: expectedClass });
  await page.locator(buttonId).click();
  await page.waitForFunction(lifecycleClass => (
    window.__panelMotionCapture?.lifecycleClass === lifecycleClass
  ), expectedClass, { timeout: 5000 });
  return page.evaluate(() => window.__panelMotionCapture);
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
        '--force-device-scale-factor=0.75',
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
    assert.ok(await page.evaluate(() => window.innerWidth > 1120));

    assert.equal(await page.locator('.repo-tab.active').count(), 1);
    assert.equal(await page.locator('#workspace').getAttribute('aria-busy'), 'false');
    assert.match(
      await page.locator('.repo-tab.active .repo-tab-name').getAttribute('title'),
      /repo/i
    );
    assert.ok(await page.locator('.graph-row').count() < 100);
    assert.match(await page.locator('.graph-row').first().innerText(), /Initial fixture commit/);

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    assert.equal(await page.evaluate(() => (
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )), false);
    const inspector = page.locator('#detail-panel');
    if (await inspector.evaluate(element => getComputedStyle(element).display === 'none')) {
      await page.locator('#btn-toggle-inspector').click();
      await page.waitForFunction(() => (
        getComputedStyle(document.getElementById('detail-panel')).display !== 'none'
      ));
    }
    await inspector.evaluate(async element => {
      await Promise.allSettled(element.getAnimations().map(animation => animation.finished));
    });

    const panelMotions = [
      ['#btn-toggle-sidebar', 'sidebar', 'motion-panel-exit-left', 'is-sidebar-closing', 'closing'],
      ['#btn-toggle-sidebar', 'sidebar', 'motion-panel-enter-left', 'is-sidebar-opening', 'opening'],
      ['#btn-toggle-inspector', 'detail-panel', 'motion-panel-exit-right', 'is-inspector-closing', 'closing'],
      ['#btn-toggle-inspector', 'detail-panel', 'motion-panel-enter-right', 'is-inspector-opening', 'opening']
    ];
    for (const [buttonId, panelId, expectedName, expectedClass, expectedState] of panelMotions) {
      const motion = await capturePanelMotion(
        page, buttonId, panelId, expectedName, expectedClass
      );
      assert.equal(motion.animationName, expectedName);
      assert.equal(motion.motionState, expectedState);
      assert.equal(motion.workspaceTransitionProperty, 'none');
    }

    const branchSearch = page.locator('#branch-search');
    const branchSearchVisible = await branchSearch.isVisible();
    if (branchSearchVisible) {
      await branchSearch.fill('feature');
      await page.getByText('feature/known-branch', { exact: true }).waitFor();
    }

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
    assert.equal(remoteActionTelemetry.branchFilter, branchSearchVisible ? 'feature' : '');
    if (branchSearchVisible) await branchSearch.fill('');

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
    const diagnostics = [];
    if (page) {
      await page.screenshot({
        path: path.join(artifactDirectory, 'failure.png'),
        fullPage: true
      }).catch(() => {});
      diagnostics.push(await page.evaluate(() => ({
        repo: window.app?.state?.repo?.path || null,
        tabs: window.app?.components?.repoTabs?.repos?.map(repo => repo.path) || [],
        activeIndex: window.app?.state?.activeRepoIndex ?? null,
        loadState: document.getElementById('workspace')?.dataset.loadState || null,
        busy: document.getElementById('workspace')?.getAttribute('aria-busy') || null,
        bodyText: document.body.innerText.slice(0, 500)
      })).catch(diagError => ({ evaluateFailed: String(diagError) })));
    }
    if (application) {
      diagnostics.push(await application.evaluate(() => ({
        argv: process.argv.slice(1),
        cwd: process.cwd()
      })).catch(mainError => ({ mainEvaluateFailed: String(mainError) })));
      const logPath = path.join(fixture.userData, 'logs', 'gittree.log');
      if (fs.existsSync(logPath)) {
        diagnostics.push({ mainLog: fs.readFileSync(logPath, 'utf8').slice(-2000) });
      }
      await application.context().tracing.stop({
        path: path.join(artifactDirectory, 'trace.zip')
      }).catch(() => {});
    }
    console.error('E2E diagnostics:', JSON.stringify(diagnostics, null, 2));
    throw error;
  } finally {
    if (!failed && application) await application.context().tracing.stop();
  }
});

test('Electron welcome is full-bleed and exposes only About and updates', async t => {
  const fixture = createElectronFixture();
  let application;

  t.after(async () => {
    if (application) await application.close();
    fixture.cleanup();
  });

  application = await electron.launch({
    args: [
      projectRoot,
      '--force-device-scale-factor=0.75',
      `--user-data-dir=${fixture.userData}`
    ],
    cwd: projectRoot
  });
  const page = await application.firstWindow();
  await page.locator('#welcome-screen:not(.is-hidden)').waitFor({ timeout: 60000 });

  const welcomeLayout = await page.locator('.welcome-card').evaluate(element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      borderWidths: [
        style.borderTopWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
        style.borderLeftWidth
      ],
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight }
    };
  });
  assert.deepEqual(welcomeLayout.borderWidths, ['0px', '0px', '0px', '0px']);
  assert.equal(welcomeLayout.borderRadius, '0px');
  assert.equal(welcomeLayout.boxShadow, 'none');
  assert.equal(welcomeLayout.rect.x, 0);
  assert.equal(welcomeLayout.rect.y, 0);
  assert.ok(Math.abs(welcomeLayout.rect.width - welcomeLayout.viewport.width) <= 1);
  assert.ok(Math.abs(welcomeLayout.rect.height - welcomeLayout.viewport.height) <= 1);

  const welcomeSettings = page.getByRole('button', { name: /Settings|Impostazioni/ });
  await welcomeSettings.click();
  await page.locator('.settings-dialog.settings-dialog-about').waitFor();
  assert.equal(await page.locator('[data-settings-section]').count(), 1);
  assert.equal(await page.locator('[data-settings-section="about"]').count(), 1);
  assert.equal(await page.locator('[data-settings-section="appearance"]').count(), 0);
  assert.equal(await page.locator('#btn-check-update').isVisible(), true);
  assert.equal(await page.locator('#btn-export-diagnostics').count(), 0);
});
