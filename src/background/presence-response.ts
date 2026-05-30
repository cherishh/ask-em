import type { Provider, WorkspaceSummary } from '../runtime/protocol';
import type { LocalState, SessionState, Workspace } from '../runtime/types';
import { getDefaultFanOutTargetProviderList } from '../runtime/workspace';
import { canStartNewSet, buildWorkspaceSummary } from './status';

type BasePresenceResponse = {
  ok: true;
  globalSyncEnabled: boolean;
  autoSyncNewChatsEnabled: boolean;
  nextFanOutTargetCount: number;
  canStartNewSet: boolean;
  shortcuts: LocalState['shortcuts'];
};

export function buildStandalonePresenceResponse(localState: LocalState, provider: Provider): BasePresenceResponse & {
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
    nextFanOutTargetCount: getDefaultFanOutTargetProviderList(localState, provider).length,
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
    nextFanOutTargetCount: 0,
    canStartNewSet: canStartNewSet(localState),
    enabledProviders: workspace.enabledProviders,
    shortcuts: localState.shortcuts,
    workspaceSummary: buildWorkspaceSummary(workspace, sessionState),
  };
}
