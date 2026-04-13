import type { ProviderDeliveryResult, WorkspaceIssue } from '../runtime/protocol';
import { clearWorkspaceProviderIssue, setWorkspaceProviderIssue } from '../runtime/workspace';
import type { LocalState } from '../runtime/protocol';

export function classifyDeliveryIssue(result: ProviderDeliveryResult): WorkspaceIssue | null {
  if (result.ok) {
    return null;
  }

  const normalizedReason = (result.reason ?? '').toLowerCase();

  if (normalizedReason.includes('login required')) {
    return 'needs-login';
  }

  if (normalizedReason.includes('not ready') || normalizedReason.includes('blocked')) {
    return 'loading';
  }

  return 'delivery-failed';
}

export function applyDeliveryResultsToWorkspaceIssues(
  state: LocalState,
  workspaceId: string,
  deliveryResults: ProviderDeliveryResult[],
): LocalState {
  return deliveryResults.reduce((nextState, result) => {
    const issue = classifyDeliveryIssue(result);

    if (issue === null) {
      return clearWorkspaceProviderIssue(nextState, workspaceId, result.provider);
    }

    return setWorkspaceProviderIssue(nextState, workspaceId, result.provider, issue);
  }, state);
}
