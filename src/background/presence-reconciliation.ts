import type { PageKind, Provider } from '../runtime/protocol';
import type { LocalState, SessionState } from '../runtime/types';
import { clearClaimedTab } from '../runtime/storage';
import { lookupWorkspaceBySession } from '../runtime/workspace';
import { getClaimedTabByTabId } from './claimed-tabs';
import { scheduleGroupGcIfEmpty } from './gc';
import { logDebug } from './debug';

export async function detachClaimedTabForNewChat(
  localState: LocalState,
  sessionState: SessionState,
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
  localState: LocalState,
  sessionState: SessionState,
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
  localState: LocalState,
  sessionState: SessionState,
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
  localState: LocalState,
  sessionState: SessionState,
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

type ClaimedTabReconciliationInput = {
  localState: LocalState;
  sessionState: SessionState;
  tabId: number;
  provider: Provider;
  pageKind: PageKind;
  sessionId: string | null;
  currentUrl: string;
  allowClaimedFallback: boolean;
  logMessages: {
    newChat: string;
    foreignSession: string;
    unresolvedExistingSession: string;
  };
};

export async function reconcileClaimedTabContext(input: ClaimedTabReconciliationInput) {
  let { localState, sessionState } = input;

  if (input.pageKind === 'new-chat' && input.sessionId === null) {
    const detachResult = await detachClaimedTabForNewChat(
      localState,
      sessionState,
      input.tabId,
      input.provider,
      input.currentUrl,
      input.logMessages.newChat,
    );
    sessionState = detachResult.sessionState;
  }

  let workspaceLookup = lookupWorkspaceBySession(localState, input.provider, input.sessionId);

  if (workspaceLookup) {
    sessionState = await transferClaimedTabToWorkspace(
      localState,
      sessionState,
      input.tabId,
      input.provider,
      workspaceLookup.workspaceId,
    );
  }

  if (!workspaceLookup && input.sessionId) {
    const detachResult = await detachClaimedTabForForeignSession(
      localState,
      sessionState,
      input.tabId,
      input.provider,
      input.sessionId,
      input.logMessages.foreignSession,
    );
    sessionState = detachResult.sessionState;
  }

  if (!workspaceLookup && input.pageKind === 'existing-session' && input.sessionId === null) {
    const detachResult = await detachClaimedTabForUnresolvedExistingSession(
      localState,
      sessionState,
      input.tabId,
      input.provider,
      input.logMessages.unresolvedExistingSession,
    );
    sessionState = detachResult.sessionState;
  }

  if (!workspaceLookup && input.allowClaimedFallback) {
    const claimedTab = getClaimedTabByTabId(sessionState, input.tabId, input.provider);
    const claimedWorkspace = claimedTab ? localState.workspaces[claimedTab.workspaceId] : null;

    if (claimedTab && claimedWorkspace) {
      workspaceLookup = {
        workspaceId: claimedTab.workspaceId,
        workspace: claimedWorkspace,
      };
    }
  }

  return {
    localState,
    sessionState,
    workspaceLookup,
  };
}
