import type { ProviderAdapter } from '../adapters/types';
import type {
  PageState,
  WorkspaceSummary,
} from '../runtime/protocol';
import type { PresenceResponse, SubmitResponse } from './context';
import {
  applyIncomingSyncProgress,
  reconcileSyncProgressForWorkspace,
} from './sync-progress';
import {
  getContentIndicatorPresentation,
  getCurrentWarningIndicatorPresentation,
  getSyncingIndicatorPresentation,
  type IndicatorAlertLevel,
  type SyncProgressSnapshot,
} from './indicator';
import {
  createInitialSubmitRuntime,
  isSubmitRuntimeSuppressed,
  rememberProgrammaticSubmitInRuntime,
  rememberSubmitFingerprintInRuntime,
  shouldSkipDuplicateSubmitInRuntime,
  shouldSuppressProgrammaticSubmitInRuntime,
  suppressSubmitRuntime,
} from './submit-runtime';
import type { UiContext } from './ui';
import {
  applyPresenceResponseToView,
  applySubmitResponseToView,
  createInitialViewRuntime,
  setViewProviderEnabled,
  setViewStandaloneCreateSetEnabled,
  setViewWorkspaceSummary,
} from './view-runtime';
export type { PresenceResponse, SubmitResponse } from './context';

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
  const viewRuntime = createInitialViewRuntime();
  const syncRuntime: {
    syncProgress: SyncProgressSnapshot | null;
    pendingSyncProgress: SyncProgressSnapshot | null;
  } = {
    syncProgress: null,
    pendingSyncProgress: null,
  };
  const submitRuntime = createInitialSubmitRuntime();

  const syncPendingProgress = () => {
    const nextState = reconcileSyncProgressForWorkspace(
      {
        syncProgress: syncRuntime.syncProgress,
        pendingSyncProgress: syncRuntime.pendingSyncProgress,
      },
      viewRuntime.uiContext.workspaceId,
    );
    syncRuntime.syncProgress = nextState.syncProgress;
    syncRuntime.pendingSyncProgress = nextState.pendingSyncProgress;
  };

  const getIndicatorInput = (
    pageState: PageState,
    overrideSyncProgress: SyncProgressSnapshot | null = syncRuntime.syncProgress,
  ) => ({
    hasWorkspace: Boolean(viewRuntime.uiContext.workspaceId),
    globalSyncEnabled: viewRuntime.uiContext.globalSyncEnabled,
    providerEnabled: viewRuntime.uiContext.providerEnabled,
    standaloneReady: viewRuntime.uiContext.standaloneReady,
    standaloneCreateSetEnabled: viewRuntime.uiContext.standaloneCreateSetEnabled,
    canStartNewSet: viewRuntime.uiContext.canStartNewSet,
    pageState,
    workspaceSummary: viewRuntime.workspaceSummary,
    syncProgress:
      overrideSyncProgress && overrideSyncProgress.workspaceId === viewRuntime.uiContext.workspaceId
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
    ui.setContext(setViewStandaloneCreateSetEnabled(viewRuntime, nextEnabled));
  };

  const setProviderEnabled = (nextEnabled: boolean) => {
    ui.setContext(setViewProviderEnabled(viewRuntime, nextEnabled));
  };

  const applyPresenceResponse = (response: PresenceResponse | null) => {
    const viewUpdate = applyPresenceResponseToView(
      viewRuntime,
      response,
      shouldShowStandaloneIndicator(adapter),
    );
    ui.setContext(viewUpdate.uiContext);
    ui.setVisible(viewUpdate.visible);
  };

  const applySubmitResponse = (response: SubmitResponse | null) => {
    const viewUpdate = applySubmitResponseToView(
      viewRuntime,
      response,
      shouldShowStandaloneIndicator(adapter),
    );
    ui.setContext(viewUpdate.uiContext);
    ui.setVisible(viewUpdate.visible);
    syncRuntime.syncProgress = null;
  };

  const handleSyncProgress = (progress: SyncProgressSnapshot) => {
    const nextState = applyIncomingSyncProgress(
      {
        syncProgress: syncRuntime.syncProgress,
        pendingSyncProgress: syncRuntime.pendingSyncProgress,
      },
      viewRuntime.uiContext.workspaceId,
      progress,
    );
    syncRuntime.syncProgress = nextState.syncProgress;
    syncRuntime.pendingSyncProgress = nextState.pendingSyncProgress;

    if (viewRuntime.uiContext.workspaceId === progress.workspaceId) {
      applyIndicatorPresentation();
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
    rememberProgrammaticSubmitInRuntime(submitRuntime, content);
  };

  const shouldSuppressProgrammaticSubmit = (content: string) => {
    return shouldSuppressProgrammaticSubmitInRuntime(submitRuntime, content);
  };

  return {
    getUiContext: () => viewRuntime.uiContext,
    hasHydratedPresence: () => viewRuntime.hasHydratedPresence,
    getWorkspaceSummary: () => viewRuntime.workspaceSummary,
    setWorkspaceSummary: (nextSummary: WorkspaceSummary | null) => {
      setViewWorkspaceSummary(viewRuntime, nextSummary);
    },
    isSubmissionSuppressed: (now = Date.now()) => isSubmitRuntimeSuppressed(submitRuntime, now),
    shouldSkipDuplicateSubmit(fingerprint: string, now = Date.now()) {
      return shouldSkipDuplicateSubmitInRuntime(submitRuntime, fingerprint, now);
    },
    rememberSubmitFingerprint(fingerprint: string, now = Date.now()) {
      rememberSubmitFingerprintInRuntime(submitRuntime, fingerprint, now);
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
    suppressObservedSubmissions(durationMs: number, now = Date.now()) {
      suppressSubmitRuntime(submitRuntime, durationMs, now);
    },
  };
}

export type ContentStateController = ReturnType<typeof createContentState>;
