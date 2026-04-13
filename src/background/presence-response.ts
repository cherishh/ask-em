import type { Provider, WorkspaceSummary } from '../runtime/protocol';
import type { LocalState, SessionState, Workspace } from '../runtime/types';
import { canStartNewSet, buildWorkspaceSummary } from './status';

type BasePresenceResponse = {
  ok: true;
  globalSyncEnabled: boolean;
  autoSyncNewChatsEnabled: boolean;
  canStartNewSet: boolean;
  shortcuts: LocalState['shortcuts'];
};

export function buildStandalonePresenceResponse(localState: LocalState): BasePresenceResponse & {
  workspaceId: null;
  providerEnabled: false;
  workspaceSummary: null;
} {
  return {
    ok: true,
    workspaceId: null,
    providerEnabled: false,
    globalSyncEnabled: localState.globalSyncEnabled,
    autoSyncNewChatsEnabled: localState.autoSyncNewChatsEnabled,
    canStartNewSet: canStartNewSet(localState),
    shortcuts: localState.shortcuts,
    workspaceSummary: null,
  };
}

export function buildWorkspacePresenceResponse(
  localState: LocalState,
  sessionState: SessionState,
  workspaceId: string,
  workspace: Workspace,
  provider: Provider,
): BasePresenceResponse & {
  workspaceId: string;
  providerEnabled: boolean;
  enabledProviders: Provider[];
  workspaceSummary: WorkspaceSummary;
} {
  return {
    ok: true,
    workspaceId,
    providerEnabled: workspace.enabledProviders.includes(provider),
    globalSyncEnabled: localState.globalSyncEnabled,
    autoSyncNewChatsEnabled: localState.autoSyncNewChatsEnabled,
    canStartNewSet: canStartNewSet(localState),
    enabledProviders: workspace.enabledProviders,
    shortcuts: localState.shortcuts,
    workspaceSummary: buildWorkspaceSummary(workspace, sessionState),
  };
}
