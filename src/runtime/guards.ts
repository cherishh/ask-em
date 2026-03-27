import { MAX_WORKSPACES, type LocalState, type Provider, type UserSubmitMessage } from './protocol';
import type { AdapterSnapshot } from '../adapters/types';

export function canCreateWorkspaceFromSubmit(
  state: LocalState,
  message: UserSubmitMessage,
  limit = MAX_WORKSPACES,
): boolean {
  return (
    state.globalSyncEnabled &&
    message.pageKind === 'new-chat' &&
    message.sessionId === null &&
    Object.keys(state.workspaces).length < limit
  );
}

export function shouldSyncWorkspaceProvider(
  sourceProvider: Provider,
  targetProvider: Provider,
  enabledProviders: Provider[],
): boolean {
  return sourceProvider !== targetProvider && enabledProviders.includes(targetProvider);
}

export function matchesExpectedTarget(
  snapshot: AdapterSnapshot,
  expected: {
    expectedSessionId: string | null;
    expectedUrl: string | null;
  },
): boolean {
  if (expected.expectedSessionId) {
    return snapshot.sessionId === expected.expectedSessionId;
  }

  if (expected.expectedUrl) {
    return snapshot.currentUrl === expected.expectedUrl;
  }

  return snapshot.pageKind === 'new-chat';
}
