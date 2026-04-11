import type { HelloMessage, HeartbeatMessage, Provider } from '../runtime/protocol';
import { clearClaimedTab, getLocalState, getSessionState, setLocalState, upsertClaimedTab } from '../runtime/storage';
import { bindWorkspaceMember, lookupWorkspaceBySession } from '../runtime/workspace';
import { getClaimedTabByTabId } from '../runtime/recovery';
import { cancelScheduledGroupGc, scheduleGroupGcIfEmpty } from './gc';
import { logDebug } from './debug';
import { refreshPendingState } from './state';
import { buildWorkspaceSummary, canStartNewSet } from './status';

export async function detachClaimedTabForNewChat(
  localState: Awaited<ReturnType<typeof getLocalState>>,
  sessionState: Awaited<ReturnType<typeof getSessionState>>,
  tabId: number,
  provider: Provider,
  currentUrl: string,
  logMessage: string,
) {
  const claimedTab = getClaimedTabByTabId(sessionState, tabId, provider);
  const claimedWorkspace = claimedTab ? localState.workspaces[claimedTab.workspaceId] : null;
  const member = claimedWorkspace?.members[provider];
  const isPendingSourceBinding = Boolean(
    claimedWorkspace &&
    claimedWorkspace.pendingSource === provider &&
    claimedWorkspace.members[provider]?.sessionId === null,
  );
  const hasBoundMemberSession = Boolean(member?.sessionId);
  const isStillOnBoundUrl = Boolean(member?.url && currentUrl === member.url);

  if (
    !claimedTab ||
    !claimedWorkspace ||
    isPendingSourceBinding ||
    !hasBoundMemberSession ||
    isStillOnBoundUrl
  ) {
    return {
      sessionState,
      detachedWorkspaceId: null,
    };
  }

  const nextSessionState = await clearClaimedTab(claimedTab.workspaceId, provider);

  await logDebug({
    level: 'info',
    scope: 'background',
    workspaceId: claimedTab.workspaceId,
    provider,
    message: logMessage,
  });

  await scheduleGroupGcIfEmpty(claimedTab.workspaceId);

  return {
    sessionState: nextSessionState,
    detachedWorkspaceId: claimedTab.workspaceId,
  };
}

export async function detachClaimedTabForForeignSession(
  localState: Awaited<ReturnType<typeof getLocalState>>,
  sessionState: Awaited<ReturnType<typeof getSessionState>>,
  tabId: number,
  provider: Provider,
  sessionId: string | null,
  logMessage: string,
) {
  if (!sessionId) {
    return {
      sessionState,
      detachedWorkspaceId: null,
    };
  }

  const claimedTab = getClaimedTabByTabId(sessionState, tabId, provider);
  const claimedWorkspace = claimedTab ? localState.workspaces[claimedTab.workspaceId] : null;
  const member = claimedWorkspace?.members[provider];
  const isPendingSourceBinding = Boolean(
    claimedWorkspace &&
    claimedWorkspace.pendingSource === provider &&
    claimedWorkspace.members[provider]?.sessionId === null,
  );
  const hasBoundMemberSession = Boolean(member?.sessionId);
  const isStillOnBoundSession = member?.sessionId === sessionId;

  if (
    !claimedTab ||
    !claimedWorkspace ||
    isPendingSourceBinding ||
    !hasBoundMemberSession ||
    isStillOnBoundSession
  ) {
    return {
      sessionState,
      detachedWorkspaceId: null,
    };
  }

  const nextSessionState = await clearClaimedTab(claimedTab.workspaceId, provider);

  await logDebug({
    level: 'info',
    scope: 'background',
    workspaceId: claimedTab.workspaceId,
    provider,
    message: logMessage,
    detail: `${member?.sessionId ?? 'unbound'} -> ${sessionId}`,
  });

  await scheduleGroupGcIfEmpty(claimedTab.workspaceId);

  return {
    sessionState: nextSessionState,
    detachedWorkspaceId: claimedTab.workspaceId,
  };
}

export async function detachClaimedTabForUnresolvedExistingSession(
  localState: Awaited<ReturnType<typeof getLocalState>>,
  sessionState: Awaited<ReturnType<typeof getSessionState>>,
  tabId: number,
  provider: Provider,
  logMessage: string,
) {
  const claimedTab = getClaimedTabByTabId(sessionState, tabId, provider);
  const claimedWorkspace = claimedTab ? localState.workspaces[claimedTab.workspaceId] : null;
  const member = claimedWorkspace?.members[provider];
  const isPendingSourceBinding = Boolean(
    claimedWorkspace &&
    claimedWorkspace.pendingSource === provider &&
    claimedWorkspace.members[provider]?.sessionId === null,
  );
  const hasBoundMemberSession = Boolean(member?.sessionId);

  if (!claimedTab || !claimedWorkspace || isPendingSourceBinding || !hasBoundMemberSession) {
    return {
      sessionState,
      detachedWorkspaceId: null,
    };
  }

  const nextSessionState = await clearClaimedTab(claimedTab.workspaceId, provider);

  await logDebug({
    level: 'info',
    scope: 'background',
    workspaceId: claimedTab.workspaceId,
    provider,
    message: logMessage,
    detail: `${member?.sessionId ?? 'unbound'} -> unresolved existing-session`,
  });

  await scheduleGroupGcIfEmpty(claimedTab.workspaceId);

  return {
    sessionState: nextSessionState,
    detachedWorkspaceId: claimedTab.workspaceId,
  };
}

export async function transferClaimedTabToWorkspace(
  localState: Awaited<ReturnType<typeof getLocalState>>,
  sessionState: Awaited<ReturnType<typeof getSessionState>>,
  tabId: number,
  provider: Provider,
  targetWorkspaceId: string,
) {
  const claimedTab = getClaimedTabByTabId(sessionState, tabId, provider);

  if (!claimedTab || claimedTab.workspaceId === targetWorkspaceId) {
    return sessionState;
  }

  const nextSessionState = await clearClaimedTab(claimedTab.workspaceId, provider);

  await logDebug({
    level: 'info',
    scope: 'background',
    workspaceId: claimedTab.workspaceId,
    provider,
    message: 'Transferred claimed tab to matching workspace session',
    detail: `${claimedTab.workspaceId} -> ${targetWorkspaceId}`,
  });

  if (localState.workspaces[claimedTab.workspaceId]) {
    await scheduleGroupGcIfEmpty(claimedTab.workspaceId);
  }

  return nextSessionState;
}

export async function handlePresenceMessage(message: HelloMessage | HeartbeatMessage, sender: chrome.runtime.MessageSender) {
  const tabId = sender.tab?.id;
  if (!tabId) {
    return { ok: false };
  }

  const refreshedState = await refreshPendingState();
  let localState = refreshedState.localState;
  let sessionState = refreshedState.sessionState;

  if (message.pageKind === 'new-chat' && message.sessionId === null) {
    const detachResult = await detachClaimedTabForNewChat(
      localState,
      sessionState,
      tabId,
      message.provider,
      message.currentUrl,
      'Detached claimed tab from previous group on new-chat navigation',
    );
    sessionState = detachResult.sessionState;
  }

  let workspaceLookup = lookupWorkspaceBySession(localState, message.provider, message.sessionId);

  if (workspaceLookup) {
    sessionState = await transferClaimedTabToWorkspace(
      localState,
      sessionState,
      tabId,
      message.provider,
      workspaceLookup.workspaceId,
    );
  }

  if (!workspaceLookup && message.sessionId) {
    const detachResult = await detachClaimedTabForForeignSession(
      localState,
      sessionState,
      tabId,
      message.provider,
      message.sessionId,
      'Detached claimed tab from previous group on existing-session navigation',
    );
    sessionState = detachResult.sessionState;
  }

  if (
    !workspaceLookup &&
    message.pageKind === 'existing-session' &&
    message.sessionId === null
  ) {
    const detachResult = await detachClaimedTabForUnresolvedExistingSession(
      localState,
      sessionState,
      tabId,
      message.provider,
      'Detached claimed tab from previous group on unresolved existing-session navigation',
    );
    sessionState = detachResult.sessionState;
  }

  if (!workspaceLookup) {
    const claimedTab = getClaimedTabByTabId(sessionState, tabId, message.provider);
    const claimedWorkspace = claimedTab ? localState.workspaces[claimedTab.workspaceId] : null;

    if (claimedTab && claimedWorkspace) {
      workspaceLookup = {
        workspaceId: claimedTab.workspaceId,
        workspace: claimedWorkspace,
      };
    }
  }

  if (!workspaceLookup?.workspace) {
    return {
      ok: true,
      workspaceId: null,
      providerEnabled: false,
      globalSyncEnabled: localState.globalSyncEnabled,
      canStartNewSet: canStartNewSet(localState),
      shortcuts: localState.shortcuts,
      workspaceSummary: null,
    };
  }

  cancelScheduledGroupGc(workspaceLookup.workspaceId);

  const previousClaimedTab = sessionState.claimedTabs[`${workspaceLookup.workspaceId}:${message.provider}`];
  if (message.pageState === 'login-required' && previousClaimedTab?.pageState !== 'login-required') {
    await logDebug({
      level: 'warn',
      scope: 'background',
      workspaceId: workspaceLookup.workspaceId,
      provider: message.provider,
      message: 'Provider login required',
      detail: `${previousClaimedTab?.pageState ?? 'unknown'} -> login-required @ ${message.currentUrl}`,
    });
  }

  await upsertClaimedTab(workspaceLookup.workspaceId, message.provider, {
    provider: message.provider,
    workspaceId: workspaceLookup.workspaceId,
    tabId,
    lastSeenAt: 'timestamp' in message ? message.timestamp : Date.now(),
    pageState: message.pageState,
    currentUrl: message.currentUrl,
    sessionId: message.sessionId,
  });

  if (message.sessionId) {
    localState = bindWorkspaceMember(localState, {
      workspaceId: workspaceLookup.workspaceId,
      member: {
        provider: message.provider,
        sessionId: message.sessionId,
        url: message.currentUrl,
      },
    });

    await setLocalState(localState);
  }

  const workspace = localState.workspaces[workspaceLookup.workspaceId] ?? workspaceLookup.workspace;

  return {
    ok: true,
    workspaceId: workspaceLookup.workspaceId,
    providerEnabled: workspace.enabledProviders.includes(message.provider),
    globalSyncEnabled: localState.globalSyncEnabled,
    canStartNewSet: canStartNewSet(localState),
    enabledProviders: workspace.enabledProviders,
    shortcuts: localState.shortcuts,
    workspaceSummary: buildWorkspaceSummary(workspace, await getSessionState()),
  };
}
