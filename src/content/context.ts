import type {
  ProviderDeliveryResult,
  ShortcutConfig,
  WorkspaceSummary,
} from '../runtime/protocol';
import { resolveShortcutConfig } from '../runtime/protocol';
import type { UiContext } from './ui';

export type PresenceResponse = {
  workspaceId?: string | null;
  providerEnabled?: boolean;
  globalSyncEnabled?: boolean;
  autoSyncNewChatsEnabled?: boolean;
  nextFanOutTargetCount?: number;
  canStartNewSet?: boolean;
  shortcuts?: ShortcutConfig;
  workspaceSummary?: WorkspaceSummary | null;
};

export type SubmitResponse = PresenceResponse & {
  synced?: boolean;
  deliveryResults?: ProviderDeliveryResult[];
};

type PresenceContextTransitionInput = {
  currentContext: UiContext;
  response: PresenceResponse | null;
  standaloneVisible: boolean;
  hasHydratedPresence: boolean;
  standaloneCreateSetTouched: boolean;
};

type PresenceContextTransitionResult = {
  uiContext: UiContext;
  workspaceSummary: WorkspaceSummary | null;
  standaloneCreateSetTouched: boolean;
  hasHydratedPresence: boolean;
  visible: boolean;
};

export function buildPresenceContextTransition({
  currentContext,
  response,
  standaloneVisible,
  hasHydratedPresence,
  standaloneCreateSetTouched,
}: PresenceContextTransitionInput): PresenceContextTransitionResult {
  const defaultStandaloneCreateSetEnabled = response?.autoSyncNewChatsEnabled ?? true;
  const nextWorkspaceId = response?.workspaceId ?? null;
  const leavingWorkspace = Boolean(currentContext.workspaceId) && !nextWorkspaceId;
  const enteringWorkspace = Boolean(nextWorkspaceId);
  let nextStandaloneCreateSetEnabled = currentContext.standaloneCreateSetEnabled;
  let nextStandaloneCreateSetTouched = standaloneCreateSetTouched;
  let nextStandaloneFanOutTargetCount = currentContext.standaloneFanOutTargetCount;

  if (enteringWorkspace) {
    nextStandaloneCreateSetEnabled = true;
    nextStandaloneFanOutTargetCount = null;
    nextStandaloneCreateSetTouched = false;
  } else if (!hasHydratedPresence || leavingWorkspace || !standaloneCreateSetTouched) {
    nextStandaloneCreateSetEnabled = defaultStandaloneCreateSetEnabled;
    nextStandaloneFanOutTargetCount = response?.nextFanOutTargetCount ?? null;
    nextStandaloneCreateSetTouched = false;
  } else if (response?.nextFanOutTargetCount !== undefined) {
    nextStandaloneFanOutTargetCount = response.nextFanOutTargetCount;
  }

  const uiContext: UiContext = {
    workspaceId: nextWorkspaceId,
    providerEnabled: nextWorkspaceId ? (response?.providerEnabled ?? false) : true,
    globalSyncEnabled: response?.globalSyncEnabled ?? true,
    standaloneReady: standaloneVisible,
    standaloneCreateSetEnabled: nextStandaloneCreateSetEnabled,
    standaloneFanOutTargetCount: nextStandaloneFanOutTargetCount,
    canStartNewSet: response?.canStartNewSet ?? true,
    shortcuts: resolveShortcutConfig(response?.shortcuts ?? currentContext.shortcuts),
  };

  return {
    uiContext,
    workspaceSummary: response?.workspaceSummary ?? null,
    standaloneCreateSetTouched: nextStandaloneCreateSetTouched,
    hasHydratedPresence: true,
    visible: Boolean(nextWorkspaceId) || standaloneVisible,
  };
}

type SubmitContextTransitionInput = {
  currentContext: UiContext;
  response: SubmitResponse | null;
  standaloneVisible: boolean;
};

type SubmitContextTransitionResult = {
  uiContext: UiContext;
  workspaceSummary: WorkspaceSummary | null;
  visible: boolean;
};

export function buildSubmitContextTransition({
  currentContext,
  response,
  standaloneVisible,
}: SubmitContextTransitionInput): SubmitContextTransitionResult {
  const uiContext: UiContext = {
    workspaceId: response?.workspaceId ?? null,
    providerEnabled: response?.workspaceId ? (response.providerEnabled ?? true) : true,
    globalSyncEnabled: response?.globalSyncEnabled ?? currentContext.globalSyncEnabled,
    standaloneReady: standaloneVisible,
    standaloneCreateSetEnabled: response?.workspaceId
      ? true
      : currentContext.standaloneCreateSetEnabled,
    standaloneFanOutTargetCount: response?.workspaceId
      ? null
      : response?.nextFanOutTargetCount ?? currentContext.standaloneFanOutTargetCount,
    canStartNewSet: response?.canStartNewSet ?? currentContext.canStartNewSet,
    shortcuts: currentContext.shortcuts,
  };

  return {
    uiContext,
    workspaceSummary: response?.workspaceSummary ?? null,
    visible: Boolean(uiContext.workspaceId) || standaloneVisible,
  };
}
