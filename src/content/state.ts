import type { ProviderAdapter } from '../adapters/types';
import type {
  PageState,
  ShortcutConfig,
  WorkspaceSummary,
} from '../runtime/protocol';
import { DEFAULT_SHORTCUTS, resolveShortcutConfig } from '../runtime/protocol';
import {
  getContentIndicatorPresentation,
  getCurrentWarningIndicatorPresentation,
  getSyncingIndicatorPresentation,
  type IndicatorAlertLevel,
  type SyncProgressSnapshot,
} from './indicator';
import type { UiContext } from './ui';

export type PresenceResponse = {
  workspaceId?: string | null;
  providerEnabled?: boolean;
  globalSyncEnabled?: boolean;
  autoSyncNewChatsEnabled?: boolean;
  canStartNewSet?: boolean;
  shortcuts?: ShortcutConfig;
  workspaceSummary?: WorkspaceSummary | null;
};

export type SubmitResponse = PresenceResponse & {
  synced?: boolean;
};

const PROGRAMMATIC_SUBMIT_SUPPRESS_MS = 30_000;

export function shouldShowStandaloneIndicator(adapter: ProviderAdapter): boolean {
  const status = adapter.session.getStatus();
  return status.pageKind === 'new-chat' && status.pageState === 'ready';
}

export function createContentState(
  adapter: ProviderAdapter,
  ui: {
    setContext(nextContext: UiContext): void;
    setVisible(nextVisible: boolean): void;
    setState(state: 'idle' | 'blocked' | 'syncing' | 'listening', label: string): void;
    setSyncStatus(label: string, tone?: 'neutral' | 'success' | 'warning'): void;
    setAlertLevel(level: IndicatorAlertLevel): void;
  },
) {
  let uiContext: UiContext = {
    workspaceId: null,
    providerEnabled: true,
    globalSyncEnabled: true,
    standaloneReady: false,
    standaloneCreateSetEnabled: true,
    canStartNewSet: true,
    shortcuts: DEFAULT_SHORTCUTS,
  };
  let workspaceSummary: WorkspaceSummary | null = null;
  let syncProgress: SyncProgressSnapshot | null = null;
  let pendingSyncProgress: SyncProgressSnapshot | null = null;
  let hasHydratedPresence = false;
  let standaloneCreateSetTouched = false;
  let suppressSubmissionsUntil = 0;
  let lastFingerprint = '';
  let lastFingerprintAt = 0;
  const recentProgrammaticSubmits = new Map<string, number>();

  const getSubmitContentFingerprint = (content: string) => content.trim();

  const syncPendingProgress = () => {
    if (pendingSyncProgress && pendingSyncProgress.workspaceId === uiContext.workspaceId) {
      syncProgress = pendingSyncProgress.completed < pendingSyncProgress.total ? pendingSyncProgress : null;
      pendingSyncProgress = null;
      return;
    }

    if (syncProgress && syncProgress.workspaceId !== uiContext.workspaceId) {
      syncProgress = null;
    }
  };

  const getIndicatorInput = (
    pageState: PageState,
    overrideSyncProgress: SyncProgressSnapshot | null = syncProgress,
  ) => ({
    hasWorkspace: Boolean(uiContext.workspaceId),
    globalSyncEnabled: uiContext.globalSyncEnabled,
    providerEnabled: uiContext.providerEnabled,
    standaloneReady: uiContext.standaloneReady,
    standaloneCreateSetEnabled: uiContext.standaloneCreateSetEnabled,
    canStartNewSet: uiContext.canStartNewSet,
    pageState,
    workspaceSummary,
    syncProgress:
      overrideSyncProgress && overrideSyncProgress.workspaceId === uiContext.workspaceId
        ? overrideSyncProgress
        : null,
  });

  const applyIndicatorPresentation = (status = adapter.session.getStatus()) => {
    syncPendingProgress();
    const presentation = getContentIndicatorPresentation(getIndicatorInput(status.pageState));
    ui.setState(presentation.state, presentation.label);
    ui.setSyncStatus(presentation.syncLabel, presentation.syncTone);
    ui.setAlertLevel(presentation.alertLevel);
  };

  const setStandaloneCreateSetEnabled = (nextEnabled: boolean) => {
    standaloneCreateSetTouched = true;
    uiContext = {
      ...uiContext,
      standaloneCreateSetEnabled: nextEnabled,
    };
    ui.setContext(uiContext);
  };

  const setProviderEnabled = (nextEnabled: boolean) => {
    uiContext = {
      ...uiContext,
      providerEnabled: nextEnabled,
    };
    ui.setContext(uiContext);
  };

  const applyPresenceResponse = (response: PresenceResponse | null) => {
    const standaloneVisible = shouldShowStandaloneIndicator(adapter);
    const defaultStandaloneCreateSetEnabled = response?.autoSyncNewChatsEnabled ?? true;
    const nextWorkspaceId = response?.workspaceId ?? null;
    const leavingWorkspace = Boolean(uiContext.workspaceId) && !nextWorkspaceId;
    const enteringWorkspace = Boolean(nextWorkspaceId);
    let standaloneCreateSetEnabled = uiContext.standaloneCreateSetEnabled;

    if (enteringWorkspace) {
      standaloneCreateSetEnabled = true;
      standaloneCreateSetTouched = false;
    } else if (!hasHydratedPresence || leavingWorkspace || !standaloneCreateSetTouched) {
      standaloneCreateSetEnabled = defaultStandaloneCreateSetEnabled;
      standaloneCreateSetTouched = false;
    }

    workspaceSummary = response?.workspaceSummary ?? null;
    uiContext = {
      workspaceId: nextWorkspaceId,
      providerEnabled: nextWorkspaceId ? (response?.providerEnabled ?? false) : true,
      globalSyncEnabled: response?.globalSyncEnabled ?? true,
      standaloneReady: standaloneVisible,
      standaloneCreateSetEnabled,
      canStartNewSet: response?.canStartNewSet ?? true,
      shortcuts: resolveShortcutConfig(response?.shortcuts ?? uiContext.shortcuts),
    };
    hasHydratedPresence = true;
    ui.setContext(uiContext);
    ui.setVisible(Boolean(nextWorkspaceId) || standaloneVisible);
  };

  const applySubmitResponse = (response: SubmitResponse | null) => {
    const standaloneReady = shouldShowStandaloneIndicator(adapter);
    workspaceSummary = response?.workspaceSummary ?? null;
    uiContext = {
      workspaceId: response?.workspaceId ?? null,
      providerEnabled: response?.workspaceId ? (response.providerEnabled ?? true) : true,
      globalSyncEnabled: response?.globalSyncEnabled ?? uiContext.globalSyncEnabled,
      standaloneReady,
      standaloneCreateSetEnabled: response?.workspaceId
        ? true
        : uiContext.standaloneCreateSetEnabled,
      canStartNewSet: response?.canStartNewSet ?? uiContext.canStartNewSet,
      shortcuts: uiContext.shortcuts,
    };
    ui.setContext(uiContext);
    ui.setVisible(Boolean(uiContext.workspaceId) || standaloneReady);
    syncProgress = null;
  };

  const handleSyncProgress = (progress: SyncProgressSnapshot) => {
    if (uiContext.workspaceId === progress.workspaceId) {
      syncProgress = progress.completed < progress.total ? progress : null;
      pendingSyncProgress = null;
      applyIndicatorPresentation();
    } else {
      pendingSyncProgress = progress;
    }
  };

  const setSyncing = () => {
    const status = adapter.session.getStatus();
    const presentation = getSyncingIndicatorPresentation(getIndicatorInput(status.pageState, null));
    ui.setState(presentation.state, presentation.label);
    ui.setSyncStatus(presentation.syncLabel, presentation.syncTone);
    ui.setAlertLevel(presentation.alertLevel);
  };

  const showCurrentWarning = (syncLabel: string) => {
    const pageState = adapter.session.getStatus().pageState;
    const presentation = getCurrentWarningIndicatorPresentation(
      getIndicatorInput(pageState, null),
      syncLabel,
    );
    ui.setState(presentation.state, presentation.label);
    ui.setSyncStatus(presentation.syncLabel, presentation.syncTone);
    ui.setAlertLevel(presentation.alertLevel);
  };

  const rememberProgrammaticSubmit = (content: string) => {
    recentProgrammaticSubmits.set(
      getSubmitContentFingerprint(content),
      Date.now() + PROGRAMMATIC_SUBMIT_SUPPRESS_MS,
    );
  };

  const shouldSuppressProgrammaticSubmit = (content: string) => {
    const now = Date.now();

    for (const [fingerprint, expiresAt] of recentProgrammaticSubmits) {
      if (expiresAt <= now) {
        recentProgrammaticSubmits.delete(fingerprint);
      }
    }

    const fingerprint = getSubmitContentFingerprint(content);
    const expiresAt = recentProgrammaticSubmits.get(fingerprint);

    if (!expiresAt || expiresAt <= now) {
      return false;
    }

    recentProgrammaticSubmits.delete(fingerprint);
    return true;
  };

  return {
    getUiContext: () => uiContext,
    hasHydratedPresence: () => hasHydratedPresence,
    getWorkspaceSummary: () => workspaceSummary,
    setWorkspaceSummary: (nextSummary: WorkspaceSummary | null) => {
      workspaceSummary = nextSummary;
    },
    getSuppressSubmissionsUntil: () => suppressSubmissionsUntil,
    setSuppressSubmissionsUntil: (nextValue: number) => {
      suppressSubmissionsUntil = nextValue;
    },
    getLastFingerprint: () => lastFingerprint,
    getLastFingerprintAt: () => lastFingerprintAt,
    setLastFingerprint(nextFingerprint: string, nextTimestamp: number) {
      lastFingerprint = nextFingerprint;
      lastFingerprintAt = nextTimestamp;
    },
    shouldSuppressProgrammaticSubmit,
    rememberProgrammaticSubmit,
    shouldShowStandaloneIndicator: () => shouldShowStandaloneIndicator(adapter),
    applyIndicatorPresentation,
    applyPresenceResponse,
    applySubmitResponse,
    handleSyncProgress,
    setStandaloneCreateSetEnabled,
    setProviderEnabled,
    setSyncing,
    showCurrentWarning,
  };
}

export type ContentStateController = ReturnType<typeof createContentState>;
