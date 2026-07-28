# GitTree User Guide

This guide covers the repository actions available from the workspace toolbar and their keyboard-first workflow.

## Keyboard shortcuts

| Action | Windows and Linux | macOS |
| --- | --- | --- |
| Open repository | `Ctrl+O` | `⌘O` |
| Search | `Ctrl+P` | `⌘P` |
| Fetch | `Ctrl+Shift+F` | `⌘⇧F` |
| Pull | `Ctrl+Shift+L` | `⌘⇧L` |
| Push | `Ctrl+Shift+P` | `⌘⇧P` |
| Create branch | `Ctrl+Shift+B` | `⌘⇧B` |
| Refresh workspace | `F5` | `F5` |

Shortcuts are ignored while a text field, selector or modal dialog is active. Repository mutations also require an active repository.

The same reference is available from the dedicated **Settings → Keyboard shortcuts** entry. Toolbar controls stay compact and do not repeat shortcut labels.

## Fetch

Fetch downloads remote refs and updates GitTree's knowledge of remote branches without checking out another branch or modifying working files.

Use **Fetch** or its shortcut when:

- a teammate has pushed commits;
- ahead/behind counters may be stale;
- a new remote branch should appear in the sidebar;
- you want to update repository information before pull, merge or rebase.

After a successful fetch, GitTree refreshes the graph, branch metadata and synchronization counters.

## Pull

Pull updates the current local branch from its configured remote. Review the branch name and ahead/behind indicator before running it.

GitTree does not automatically stash local work. If Git reports blocking changes or conflicts, the application preserves the operation state and exposes the appropriate recovery workflow.

## Push

Push publishes commits from the current local branch to its configured remote. Branches without an upstream use the explicit publish or remote selection workflows provided by the branch context menu.

GitTree never stores Git passwords or private SSH keys. Authentication remains delegated to the credential helper, SSH agent or operating-system tooling already configured for Git.

## Quick branch creation

Open the quick branch dialog with `Ctrl+Shift+B` on Windows/Linux or `⌘⇧B` on macOS. It is also available from the plus button and **Create branch** row in the sidebar.

The dialog provides three branch types:

- **Feature** for product work;
- **Bug fix** for corrections;
- **Custom** for an explicit branch path.

For Feature and Bug fix, GitTree inspects local and remote branch folders before suggesting a name. For example:

| Existing project folders | Description | Proposed branch |
| --- | --- | --- |
| `feature/`, `bugfix/` | `Account profiles` | `feature/account-profiles` |
| `feat/`, `fix/` | `Issue 1911` | `fix/issue-1911` |

If the project has no matching folders, the defaults are `feature/` and `bugfix/`.

Descriptions are normalized to lowercase, spaces become hyphens and unsupported characters are removed. The final branch name is shown before creation. Existing local names are rejected immediately, while the main process still performs Git's complete ref validation.

Creating the branch starts from the current `HEAD`, checks out the new branch and refreshes the workspace. The Custom option preserves the previous ability to use another hierarchy, such as `release/version-2`.

If Git rejects the operation, the dialog remains open and shows the complete error. It closes only after the new branch has been confirmed.

## History filters and sorting

The History toolbar combines:

- free-text filtering across message, full hash, author name and email;
- an author filter;
- reference filters for branches, tags, HEAD or commits without references;
- sorting by topology, newest/oldest date, author, message or hash.

Filters and sorting are stored per repository. Topological order shows the real multi-lane graph. Other sort modes use a simple commit marker because reordered rows cannot truthfully preserve Git topology.

## Creating a tag from a commit

Right-click one commit and choose **Create tag at this commit**. Enter a tag name and optionally an annotation:

- an empty annotation creates a lightweight tag;
- an annotation creates an annotated tag.

GitTree validates the name and collision in the main process before calling Git. Tag creation is unavailable for a multi-commit selection.

## Creating a pull request

The branch context menu can open a prefilled pull request page for GitHub, GitLab, Bitbucket Cloud and Azure DevOps. Azure DevOps supports current `dev.azure.com` HTTPS remotes, SSH `v3` remotes and legacy `visualstudio.com` URLs. Authentication continues in the system browser; GitTree does not handle browser credentials for this action.

## Inspector and diff layout

The Inspector supports Unified and Split layouts. Maximizing it automatically opens the Split layout so deletions stay on the left and additions stay on the right.

Changed line groups are paired row by row. File headers and hunk headers span both columns. Restoring the Inspector returns to the previous diff layout unless the layout was changed manually while maximized.
