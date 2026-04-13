import type { HeartbeatMessage, HelloMessage } from '../runtime/protocol';
import { getLocalState, getSessionState } from '../runtime/storage';
import { cancelScheduledGroupGc, scheduleGroupGcIfEmpty } from './gc';
import { persistPresenceObservation } from './presence-persistence';
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
  localState = await persistPresenceObservation({
    localState,
    sessionState,
    workspaceId: workspaceLookup.workspaceId,
    tabId,
    message,
  });

  const workspace = localState.workspaces[workspaceLookup.workspaceId] ?? workspaceLookup.workspace;

  return buildWorkspacePresenceResponse(
    localState,
    await getSessionState(),
    workspaceLookup.workspaceId,
    workspace,
    message.provider,
  );
}
