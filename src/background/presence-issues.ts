import type { Provider, WorkspaceIssue } from '../runtime/protocol';
import type { LocalState, PageState } from '../runtime/types';
import { clearWorkspaceProviderIssue, setWorkspaceProviderIssue } from '../runtime/workspace';

const PRESENCE_ISSUES: WorkspaceIssue[] = ['needs-login', 'loading', 'error-page', 'private-mode'];

function isPresenceIssue(issue: WorkspaceIssue | null | undefined): boolean {
  return Boolean(issue && PRESENCE_ISSUES.includes(issue));
}

export function getWorkspaceIssueForPageState(pageState: PageState): WorkspaceIssue | null {
  if (pageState === 'ready') {
    return null;
  }

  if (pageState === 'login-required') {
    return 'needs-login';
  }

  if (pageState === 'error') {
    return 'error-page';
  }

  if (pageState === 'not-ready') {
    return 'loading';
  }

  if (pageState === 'private-mode') {
    return 'private-mode';
  }

  return null;
}

export function applyPresenceWorkspaceIssue(
  localState: LocalState,
  workspaceId: string,
  provider: Provider,
  pageState: PageState,
  options: {
    sessionId?: string | null;
    previousMemberSessionId?: string | null;
  } = {},
): {
  localState: LocalState;
  shouldPersist: boolean;
} {
  const issue = getWorkspaceIssueForPageState(pageState);
  const existingIssue = localState.workspaces[workspaceId]?.memberIssues?.[provider] ?? null;
  const recoveredUnconfirmedDelivery =
    existingIssue === 'delivery-failed' &&
    issue === null &&
    Boolean(options.sessionId) &&
    options.previousMemberSessionId !== options.sessionId;

  if (issue === null) {
    if (!isPresenceIssue(existingIssue) && !recoveredUnconfirmedDelivery) {
      return {
        localState,
        shouldPersist: false,
      };
    }

    return {
      localState: clearWorkspaceProviderIssue(localState, workspaceId, provider),
      shouldPersist: true,
    };
  }

  return {
    localState: setWorkspaceProviderIssue(localState, workspaceId, provider, issue),
    shouldPersist: true,
  };
}
