import { MAX_WORKSPACES, type LocalState, type Provider, type UserSubmitMessage } from './protocol';

export function canCreateWorkspaceFromSubmit(
  state: LocalState,
  message: UserSubmitMessage,
  limit = MAX_WORKSPACES,
): boolean {
  return (
    state.globalSyncEnabled &&
    message.allowNewSetCreation &&
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

export function isProviderEnabled(enabledProviders: Provider[], provider: Provider): boolean {
  return enabledProviders.includes(provider);
}
