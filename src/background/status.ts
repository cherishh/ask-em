import { ALL_PROVIDERS, MAX_WORKSPACES, type StatusResponseMessage } from '../runtime/protocol';
import type { GetWorkspaceContextMessage } from '../runtime/protocol';
import { getLocalState } from '../runtime/storage';
import { getWorkspacesOrdered } from '../runtime/workspace';
import { refreshPendingState } from './state';

export function buildWorkspaceSummary(
  workspace: StatusResponseMessage['workspaces'][number]['workspace'],
  sessionState: Awaited<ReturnType<typeof import('../runtime/storage').getSessionState>>,
) {
  const memberStates = Object.fromEntries(
    ALL_PROVIDERS.map((provider) => {
      const member = workspace.members[provider];
      const claimedTab = sessionState.claimedTabs[`${workspace.id}:${provider}`];

      if (member?.sessionId === null || workspace.pendingSource === provider) {
        return [provider, 'pending'];
      }

      if (!member) {
        return [provider, 'inactive'];
      }

      if (!claimedTab) {
        return [provider, 'inactive'];
      }

      return [provider, claimedTab.pageState === 'ready' ? 'ready' : claimedTab.pageState];
    }),
  );

  const memberIssues = Object.fromEntries(
    ALL_PROVIDERS.map((provider) => [provider, workspace.memberIssues?.[provider] ?? null]),
  );

  return {
    workspace,
    memberStates,
    memberIssues,
  };
}

export function canStartNewSet(localState: Awaited<ReturnType<typeof getLocalState>>): boolean {
  return getWorkspacesOrdered(localState).length < MAX_WORKSPACES;
}

export async function handleGetStatus(): Promise<StatusResponseMessage> {
  const { localState, sessionState } = await refreshPendingState();
  const visibleWorkspaces = getWorkspacesOrdered(localState).filter(
    (workspace) => workspace.enabledProviders.length > 0 || Object.keys(workspace.members).length > 0,
  );
  const workspaces = visibleWorkspaces.map((workspace) => buildWorkspaceSummary(workspace, sessionState));

  return {
    type: 'STATUS_RESPONSE',
    globalSyncEnabled: localState.globalSyncEnabled,
    autoSyncNewChatsEnabled: localState.autoSyncNewChatsEnabled,
    debugLoggingEnabled: localState.debugLoggingEnabled,
    showDiagnostics: localState.showDiagnostics,
    closeTabsOnDeleteSet: localState.closeTabsOnDeleteSet ?? false,
    workspaceLimit: MAX_WORKSPACES,
    defaultEnabledProviders: localState.defaultEnabledProviders,
    shortcuts: localState.shortcuts,
    workspaces,
    recentLogs: localState.debugLogs.slice(-20).reverse(),
  };
}

export async function handleGetWorkspaceContext(message: GetWorkspaceContextMessage) {
  const { localState, sessionState } = await refreshPendingState();
  const workspace = localState.workspaces[message.workspaceId];

  return {
    type: 'WORKSPACE_CONTEXT_RESPONSE' as const,
    globalSyncEnabled: localState.globalSyncEnabled,
    autoSyncNewChatsEnabled: localState.autoSyncNewChatsEnabled,
    workspaceSummary: workspace ? buildWorkspaceSummary(workspace, sessionState) : null,
  };
}

export async function handleGetDebugLogs() {
  const localState = await getLocalState();
  return {
    type: 'DEBUG_LOGS_RESPONSE' as const,
    logs: localState.debugLogs,
  };
}
