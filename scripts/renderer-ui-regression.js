const endpoint = process.env.GITTREE_CDP_ENDPOINT || 'http://127.0.0.1:9222/json';

async function connect() {
  const targets = await fetch(endpoint).then(response => response.json());
  const target = targets.find(item => item.type === 'page' && item.title === 'GitTree');
  if (!target) throw new Error(`GitTree renderer not found at ${endpoint}`);

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;

  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  return {
    async call(method, params = {}) {
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() {
      if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
      return new Promise(resolve => {
        socket.addEventListener('close', resolve, { once: true });
        socket.close();
      });
    }
  };
}

async function evaluate(client, expression) {
  const result = await client.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitForRenderer(client) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const ready = await evaluate(client, `Boolean(
      window.app?.state?.repo &&
      document.querySelector('.repo-tab') &&
      window.app?.components?.branchList?.data
    )`);
    if (ready) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('GitTree renderer did not finish loading a repository');
}

const contractExpression = `
(async () => {
  const activeTabs = [...document.querySelectorAll('.repo-tab.active')];
  const nestedRows = [...document.querySelectorAll('#branch-list .branch-item')]
    .filter(row => {
      const title = row.querySelector('.branch-name')?.title || '';
      return title.replace(/^remotes\\//, '').includes('/');
    });
  const nestedLabels = nestedRows.map(row => row.querySelector('.branch-name')?.textContent || '');

  const branchList = window.app.components.branchList;
  const originalCheckout = branchList.checkout;
  const originalCheckoutRemote = branchList.checkoutRemote;
  const originalSelectedBranchKey = branchList.selectedBranchKey;
  const originalSelectedBranchElement = branchList.selectedBranchElement;
  const target = branchList.branchRow(
    { name: 'feature/__renderer-ui-contract__' },
    branchList.current,
    false,
    '__renderer-ui-contract__'
  );
  branchList.container.appendChild(target);

  let activations = 0;
  branchList.checkout = () => { activations += 1; };
  branchList.checkoutRemote = () => { activations += 1; };

  target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const afterSingleClick = activations;
  const selectedStyle = getComputedStyle(target);
  const activeRow = document.querySelector('#branch-list .branch-item.active');
  const activeStyle = activeRow ? getComputedStyle(activeRow) : null;
  const selectedLooksDistinct =
    selectedStyle.boxShadow !== 'none' &&
    (!activeStyle || selectedStyle.backgroundColor !== activeStyle.backgroundColor);
  target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const afterDoubleClick = activations;

  branchList.checkout = originalCheckout;
  branchList.checkoutRemote = originalCheckoutRemote;
  target.remove();
  branchList.selectedBranchKey = originalSelectedBranchKey;
  branchList.selectedBranchElement =
    originalSelectedBranchElement?.isConnected ? originalSelectedBranchElement : null;
  branchList.selectedBranchElement?.classList.add('selected');

  const commandBar = document.querySelector('.workspace-command-bar');
  const workspaceBody = document.getElementById('workspace-body');
  const remoteActions = ['btn-fetch', 'btn-pull', 'btn-push', 'btn-refresh']
    .map(id => document.getElementById(id));

  const originalInspectorState = window.app.inspectorState;
  const originalInspectorStorage = localStorage.getItem('gittree.workspace.inspector');
  window.app.setInspectorState('open', false);
  document.getElementById('btn-maximize-inspector').click();
  const maximizes = window.app.inspectorState === 'maximized' &&
    workspaceBody.classList.contains('inspector-maximized');
  document.getElementById('btn-maximize-inspector').click();
  document.getElementById('btn-close-inspector').click();
  const closes = window.app.inspectorState === 'closed' &&
    workspaceBody.classList.contains('inspector-closed');
  const inspectorPersists =
    localStorage.getItem('gittree.workspace.inspector') === 'closed';
  document.getElementById('btn-toggle-inspector').click();
  const reopens = window.app.inspectorState === 'open' &&
    !workspaceBody.classList.contains('inspector-closed');
  window.app.setInspectorState(originalInspectorState, false);
  if (originalInspectorStorage == null) localStorage.removeItem('gittree.workspace.inspector');
  else localStorage.setItem('gittree.workspace.inspector', originalInspectorStorage);

  const detailTitleStyle = getComputedStyle(document.getElementById('detail-title'));
  const originalTheme = document.documentElement.dataset.theme;
  const originalThemeStorage = localStorage.getItem(Theme.storageKey);
  const themeSmoke = {};
  Theme.themes.forEach(theme => {
    Theme.apply(theme, false);
    const panelBackground = getComputedStyle(document.getElementById('detail-panel')).backgroundColor;
    themeSmoke[theme] = panelBackground.startsWith('rgb(');
  });
  Theme.apply('black', false);
  const blackRootStyle = getComputedStyle(document.documentElement);
  const blackThemeIsOpaque =
    blackRootStyle.getPropertyValue('--surface-shell').trim() === '#000000' &&
    blackRootStyle.getPropertyValue('--surface-primary').trim() === '#000000';
  Theme.apply(originalTheme, false);
  if (originalThemeStorage == null) localStorage.removeItem(Theme.storageKey);
  else localStorage.setItem(Theme.storageKey, originalThemeStorage);

  const branchGroupsStorageKey = 'gittree.sidebar.branchGroups';
  const originalBranchGroupsStorage = localStorage.getItem(branchGroupsStorageKey);
  branchList.persistSet(branchGroupsStorageKey, new Set(['local']));
  const branchGroupsPersist = JSON.parse(localStorage.getItem(branchGroupsStorageKey)).includes('local');
  if (originalBranchGroupsStorage == null) localStorage.removeItem(branchGroupsStorageKey);
  else localStorage.setItem(branchGroupsStorageKey, originalBranchGroupsStorage);

  const sidebarSectionsStorageKey = 'gittree.sidebar.sections';
  const originalSidebarSectionsStorage = localStorage.getItem(sidebarSectionsStorageKey);
  const stashHeader = document.querySelector('[data-section="stashes"] .sidebar-section-header');
  stashHeader.click();
  const stashStateAfterClick = stashHeader.classList.contains('collapsed');
  const sidebarSectionsPersist =
    JSON.parse(localStorage.getItem(sidebarSectionsStorageKey)).includes('stashes') ===
    stashStateAfterClick;
  stashHeader.click();
  if (originalSidebarSectionsStorage == null) localStorage.removeItem(sidebarSectionsStorageKey);
  else localStorage.setItem(sidebarSectionsStorageKey, originalSidebarSectionsStorage);

  const originalLanguage = i18next.language;
  await i18next.changeLanguage('it');
  I18n.translateDOM();
  const italianSmoke =
    document.querySelector('.toolbar-title h2').textContent === 'Cronologia commit';
  await i18next.changeLanguage('en');
  I18n.translateDOM();
  const englishSmoke =
    document.querySelector('.toolbar-title h2').textContent === 'Commit history';
  await i18next.changeLanguage(originalLanguage);
  I18n.translateDOM();
  Theme.syncControls();

  return {
    activeTab: {
      count: activeTabs.length,
      matchesCurrentRepo:
        activeTabs[0]?.querySelector('.repo-tab-name')?.title === window.app.state.repo.path,
      selectedOnStartup:
        activeTabs.length === 1 &&
        activeTabs[0]?.querySelector('.repo-tab-name')?.title === window.app.state.repo.path
    },
    branchLabels: {
      checked: nestedLabels.length,
      sample: nestedLabels.slice(0, 5),
      synthetic: target.querySelector('.branch-name')?.textContent,
      showLeafOnly:
        target.querySelector('.branch-name')?.textContent === '__renderer-ui-contract__' &&
        nestedLabels.every(label => !label.includes('/'))
    },
    branchActivation: {
      afterSingleClick,
      afterDoubleClick,
      requiresDoubleClick: afterSingleClick === 0 && afterDoubleClick === 1,
      selectedLooksDistinct
    },
    workspaceToolbar: {
      actionsMovedAboveWorkspace:
        remoteActions.every(action => action?.parentElement?.parentElement === commandBar) &&
        Boolean(commandBar.compareDocumentPosition(workspaceBody) & Node.DOCUMENT_POSITION_FOLLOWING),
      searchRemainsInHistory: !commandBar.contains(document.getElementById('global-search'))
    },
    inspector: {
      maximizes,
      closes,
      reopens,
      persists: inspectorPersists,
      compactTitle:
        detailTitleStyle.whiteSpace === 'nowrap' &&
        detailTitleStyle.overflow === 'hidden' &&
        detailTitleStyle.textOverflow === 'ellipsis'
    },
    persistence: {
      branchGroups: branchGroupsPersist,
      sidebarSections: sidebarSectionsPersist
    },
    themes: {
      available: Theme.themes,
      blackThemeIsOpaque,
      smoke: themeSmoke
    },
    localization: {
      english: englishSmoke,
      italian: italianSmoke
    }
  };
})()
`;

async function main() {
  const client = await connect();
  try {
    await waitForRenderer(client);
    const contracts = await evaluate(client, contractExpression);
    console.log(JSON.stringify(contracts, null, 2));

    if (!contracts.activeTab.selectedOnStartup ||
        !contracts.branchLabels.showLeafOnly ||
        !contracts.branchActivation.requiresDoubleClick ||
        !contracts.branchActivation.selectedLooksDistinct ||
        !contracts.workspaceToolbar.actionsMovedAboveWorkspace ||
        !contracts.workspaceToolbar.searchRemainsInHistory ||
        !contracts.inspector.maximizes ||
        !contracts.inspector.closes ||
        !contracts.inspector.reopens ||
        !contracts.inspector.persists ||
        !contracts.inspector.compactTitle ||
        !contracts.persistence.branchGroups ||
        !contracts.persistence.sidebarSections ||
        !contracts.themes.blackThemeIsOpaque ||
        !Object.values(contracts.themes.smoke).every(Boolean) ||
        contracts.themes.available.length !== 3 ||
        !contracts.localization.english ||
        !contracts.localization.italian) {
      process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
