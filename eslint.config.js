const js = require('@eslint/js');

const appGlobals = {
  i18next: 'readonly',
  t: 'readonly',
  Theme: 'readonly',
  HtmlEncoder: 'readonly',
  DialogService: 'readonly',
  RepositoryLoadSession: 'readonly',
  RemoteOperationController: 'readonly',
  WorkspacePanelMotion: 'readonly',
  LocalizedDateFormatter: 'readonly',
  DiffParser: 'readonly',
  ConflictHighlight: 'readonly',
  WelcomeScreen: 'readonly',
  RepoTabs: 'readonly',
  SettingsView: 'readonly',
  BranchContextMenu: 'readonly',
  CommitContextMenu: 'readonly',
  BranchListView: 'readonly',
  GraphView: 'readonly',
  ChangesView: 'readonly',
  PullRequestView: 'readonly',
  DiffViewer: 'readonly',
  GlobalSearch: 'readonly',
  BranchCompare: 'readonly',
  CommitCompare: 'readonly',
  MergeWorkspace: 'readonly',
  ConflictResolver: 'readonly',
  GitFlow: 'readonly',
  StatusBar: 'readonly',
  BranchNaming: 'readonly',
  I18n: 'readonly',
  ReflogView: 'readonly'
};

module.exports = [
  {
    ignores: [
      'dist/**',
      'build/**',
      'node_modules/**',
      'coverage/**',
      'package-lock.json'
    ]
  },
  js.configs.recommended,
  {
    files: ['src/main/**/*.js', 'src/preload*.js', 'scripts/**/*.js', '.agents/**/*.js', '.qoder/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...require('globals').node,
        ...require('globals').commonjs
      }
    }
  },
  {
    files: ['src/renderer/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...require('globals').browser,
        ...appGlobals
      }
    }
  },
  {
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...require('globals').node,
        ...require('globals').commonjs
      }
    }
  },
  {
    files: ['eslint.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: require('globals').node
    }
  }
];
