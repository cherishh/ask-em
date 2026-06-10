import type { HeartbeatMessage, HelloMessage } from '../runtime/protocol';
import { setLocalState, upsertClaimedTab } from '../runtime/storage';
import type { LocalState, SessionState } from '../runtime/types';
import { bindWorkspaceMember } from '../runtime/workspace';
import { logDebug } from './debug';
import { applyPresenceWorkspaceIssue } from './presence-issues';

type PersistPresenceObservationInput = {
  localState: LocalState;
  sessionState: SessionState;
  workspaceId: string;
  tabId: number;
  message: HelloMessage | HeartbeatMessage;
};

export async function persistPresenceObservation({
  localState,
  sessionState,
  workspaceId,
  tabId,
  message,
}: PersistPresenceObservationInput): Promise<LocalState> {
  const previousClaimedTab = sessionState.claimedTabs[`${workspaceId}:${message.provider}`];
  if (message.pageState === 'login-required' && previousClaimedTab?.pageState !== 'login-required') {
    await logDebug({
      level: 'warn',
      scope: 'background',
      workspaceId,
      provider: message.provider,
      message: 'Provider login required',
      detail: `${previousClaimedTab?.pageState ?? 'unknown'} -> login-required @ ${message.currentUrl}`,
    });
  }

  await upsertClaimedTab(workspaceId, message.provider, {
    provider: message.provider,
    workspaceId,
    tabId,
    lastSeenAt: 'timestamp' in message ? message.timestamp : Date.now(),
    pageState: message.pageState,
    currentUrl: message.currentUrl,
    sessionId: message.sessionId,
  });

  let nextLocalState = localState;
  const previousMemberSessionId =
    nextLocalState.workspaces[workspaceId]?.members[message.provider]?.sessionId ?? null;
  const previousIssue =
    nextLocalState.workspaces[workspaceId]?.memberIssues?.[message.provider] ?? null;

  if (message.sessionId) {
    nextLocalState = bindWorkspaceMember(nextLocalState, {
      workspaceId,
      member: {
        provider: message.provider,
        sessionId: message.sessionId,
        url: message.currentUrl,
      },
    });
  }

  const issueUpdate = applyPresenceWorkspaceIssue(
    nextLocalState,
    workspaceId,
    message.provider,
    message.pageState,
    {
      sessionId: message.sessionId,
      previousMemberSessionId,
    },
  );
  nextLocalState = issueUpdate.localState;
  const nextIssue =
    nextLocalState.workspaces[workspaceId]?.memberIssues?.[message.provider] ?? null;

  if (previousIssue === 'delivery-failed' && nextIssue === null && message.sessionId) {
    await logDebug({
      level: 'info',
      scope: 'background',
      workspaceId,
      provider: message.provider,
      message: 'Recovered unconfirmed delivery from provider presence',
      detail: `${previousMemberSessionId ?? 'unbound'} -> ${message.sessionId} @ ${message.currentUrl}`,
    });
  }

  if (message.sessionId || issueUpdate.shouldPersist) {
    await setLocalState(nextLocalState);
  }

  return nextLocalState;
}
