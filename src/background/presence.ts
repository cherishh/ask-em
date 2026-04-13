import type { HeartbeatMessage, HelloMessage } from '../runtime/protocol';
import { getLocalState, getSessionState, setLocalState, upsertClaimedTab } from '../runtime/storage';
import { bindWorkspaceMember } from '../runtime/workspace';
import { cancelScheduledGroupGc, scheduleGroupGcIfEmpty } from './gc';
import { logDebug } from './debug';
import { applyPresenceWorkspaceIssue } from './presence-issues';
import {
  reconcileClaimedTabContext,
} from './presence-reconciliation';
import {
  buildStandalonePresenceResponse,
  buildWorkspacePresenceResponse,
} from './presence-response';
import { refreshPendingState } from './state';

export async function handlePresenceMessage(message: HelloMessage | HeartbeatMessage, sender: chrome.runtime.MessageSender) {
  const tabId = sender.tab?.id;
  if (!tabId) {
    return { ok: false };
  }

  const refreshedState = await refreshPendingState();
  let localState = refreshedState.localState;
  const reconciled = await reconcileClaimedTabContext({
    localState,
    sessionState: refreshedState.sessionState,
    tabId,
    provider: message.provider,
    pageKind: message.pageKind,
    sessionId: message.sessionId,
    currentUrl: message.currentUrl,
    allowClaimedFallback: true,
    logMessages: {
      newChat: 'Detached claimed tab from previous group on new-chat navigation',
      foreignSession: 'Detached claimed tab from previous group on existing-session navigation',
      unresolvedExistingSession: 'Detached claimed tab from previous group on unresolved existing-session navigation',
    },
  });
  let sessionState = reconciled.sessionState;
  const workspaceLookup = reconciled.workspaceLookup;

  if (!workspaceLookup?.workspace) {
    return buildStandalonePresenceResponse(localState);
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

  {
    const issueUpdate = applyPresenceWorkspaceIssue(
      localState,
      workspaceLookup.workspaceId,
      message.provider,
      message.pageState,
    );
    localState = issueUpdate.localState;

    if (issueUpdate.shouldPersist) {
      await setLocalState(localState);
    }
  }

  const workspace = localState.workspaces[workspaceLookup.workspaceId] ?? workspaceLookup.workspace;

  return buildWorkspacePresenceResponse(
    localState,
    await getSessionState(),
    workspaceLookup.workspaceId,
    workspace,
    message.provider,
  );
}
