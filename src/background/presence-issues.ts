import type { Provider, WorkspaceIssue } from '../runtime/protocol';
import type { LocalState, PageState } from '../runtime/types';
import { clearWorkspaceProviderIssue, setWorkspaceProviderIssue } from '../runtime/workspace';

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

  return null;
}

export function applyPresenceWorkspaceIssue(
  localState: LocalState,
  workspaceId: string,
  provider: Provider,
  pageState: PageState,
): {
  localState: LocalState;
  shouldPersist: boolean;
} {
  const issue = getWorkspaceIssueForPageState(pageState);

  if (issue === null) {
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
