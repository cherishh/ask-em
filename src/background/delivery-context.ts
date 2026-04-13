import type { LocalState, SessionState, UserSubmitMessage } from '../runtime/protocol';
import {
  bindWorkspaceMember,
  createPendingWorkspace,
  getDefaultEnabledProviderList,
  getWorkspacesOrdered,
  type WorkspaceLookupResult,
} from '../runtime/workspace';
import { setLocalState, upsertClaimedTab } from '../runtime/storage';
import { logDebug } from './debug';
import { reconcileClaimedTabContext } from './presence';
import { refreshPendingState } from './state';

type PrepareSubmitWorkspaceContextInput = {
  tabId?: number;
  message: UserSubmitMessage;
  canCreateWorkspace: (state: LocalState, message: UserSubmitMessage) => boolean;
};

type PrepareSubmitWorkspaceContextResult = {
  localState: LocalState;
  sessionState: SessionState;
  workspaceLookup: WorkspaceLookupResult;
};

export async function prepareSubmitWorkspaceContext({
  tabId,
  message,
  canCreateWorkspace,
}: PrepareSubmitWorkspaceContextInput): Promise<PrepareSubmitWorkspaceContextResult> {
  const refreshedState = await refreshPendingState();
  let { localState } = refreshedState;
  const reconciled = tabId
    ? await reconcileClaimedTabContext({
        localState,
        sessionState: refreshedState.sessionState,
        tabId,
        provider: message.provider,
        pageKind: message.pageKind,
        sessionId: message.sessionId,
        currentUrl: message.currentUrl,
        allowClaimedFallback: false,
        logMessages: {
          newChat: 'Detached claimed tab from previous group on new-chat submit',
          foreignSession: 'Detached claimed tab from previous group on existing-session submit',
          unresolvedExistingSession:
            'Detached claimed tab from previous group on unresolved existing-session submit',
        },
      })
    : {
        localState,
        sessionState: refreshedState.sessionState,
        workspaceLookup: null,
      };

  localState = reconciled.localState;
  let workspaceLookup = reconciled.workspaceLookup;

  if (!workspaceLookup && canCreateWorkspace(localState, message)) {
    const enabledProviders = getDefaultEnabledProviderList(localState, message.provider);
    const label = message.content.trim().slice(0, 80) || undefined;
    localState = createPendingWorkspace(localState, {
      sourceProvider: message.provider,
      sourceUrl: message.currentUrl,
      enabledProviders,
      label,
    });

    const workspace = getWorkspacesOrdered(localState)[0];
    workspaceLookup = workspace ? { workspaceId: workspace.id, workspace } : null;
    await setLocalState(localState);
    await logDebug({
      level: 'info',
      scope: 'background',
      provider: message.provider,
      workspaceId: workspaceLookup?.workspaceId,
      message: 'Created workspace from new-chat submit',
      detail: enabledProviders.join(', '),
    });
  }

  return {
    localState,
    sessionState: reconciled.sessionState,
    workspaceLookup,
  };
}

type PersistSourceSubmitContextInput = {
  localState: LocalState;
  workspaceLookup: NonNullable<WorkspaceLookupResult>;
  tabId?: number;
  message: UserSubmitMessage;
};

export async function persistSourceSubmitContext({
  localState,
  workspaceLookup,
  tabId,
  message,
}: PersistSourceSubmitContextInput): Promise<LocalState> {
  let nextLocalState = localState;

  if (message.sessionId) {
    nextLocalState = bindWorkspaceMember(nextLocalState, {
      workspaceId: workspaceLookup.workspaceId,
      member: {
        provider: message.provider,
        sessionId: message.sessionId,
        url: message.currentUrl,
      },
    });
    await setLocalState(nextLocalState);
  }

  if (tabId) {
    await upsertClaimedTab(workspaceLookup.workspaceId, message.provider, {
      provider: message.provider,
      workspaceId: workspaceLookup.workspaceId,
      tabId,
      lastSeenAt: Date.now(),
      pageState: 'ready',
      currentUrl: message.currentUrl,
      sessionId: message.sessionId,
    });
  }

  await logDebug({
    level: 'info',
    scope: 'background',
    provider: message.provider,
    workspaceId: workspaceLookup.workspaceId,
    message: 'User submit routed',
    detail: message.content.slice(0, 120),
  });

  return nextLocalState;
}
