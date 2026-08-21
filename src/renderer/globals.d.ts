/**
 * Type declarations for renderer classic-script globals (ADR-0008).
 * Before the ESM switch (M6a), renderer modules expose globals via script
 * tags; these declarations let checkJs verify their consumers against the
 * real module shapes instead of implicit any.
 */

declare const ToastService: any;
declare const EventBus: any;
declare const DialogService: any;
declare const HtmlEncoder: any;
declare const I18n: any;
declare const Theme: any;
declare const WelcomeScreen: any;
declare const RepoTabs: any;
declare const SettingsView: any;
declare const CommitContextMenu: any;
declare const GraphView: any;
declare const DiffViewer: any;
declare const InspectorWorkspace: any;
declare const MergeWorkspace: any;
declare const WorktreeAgentPanel: any;
declare const RepositoryWorkspaceController: any;
declare const RepositoryLoadSession: any;
declare const RemoteOperationController: any;
declare const WorkspacePanelMotion: any;
declare const WorkspaceStateController: any;
declare const ShortcutController: any;
declare const BranchList: any;
declare const BranchContextMenu: any;
declare const BranchNaming: any;
declare const ChangesView: any;
declare const ChangesFileList: any;
declare const CommitCompare: any;
declare const BranchCompare: any;
declare const ConflictResolver: any;
declare const DiffParser: any;
declare const DiffLayout: any;
declare const GraphLayout: any;
declare const InspectorGraph: any;
declare const PullRequestView: any;
declare const ReflogView: any;
declare const Search: any;
declare const StatusBar: any;
declare const Gitflow: any;
declare const LocalizedDateFormatter: any;
declare const PrCreatePrefill: any;
declare const t: (key: string, ...args: unknown[]) => string;
declare const i18next: any;

interface Window {
  gitTree: import('../shared/bridge.mts').GitTreeBridge;
  app: any;
  Theme: any;
  HtmlEncoder: any;
  t: typeof t;
  i18next: any;
}
