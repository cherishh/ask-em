import type { ProviderAdapter } from '../adapters/types';
import type {
  PageState,
  ShortcutConfig,
  WorkspaceSummary,
} from '../runtime/protocol';
import { DEFAULT_SHORTCUTS } from '../runtime/protocol';
import {
  buildPresenceContextTransition,
  buildSubmitContextTransition,
  type PresenceResponse,
  type SubmitResponse,
} from './context';
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
  rememberProgrammaticSubmit as rememberProgrammaticSubmitEntry,
  shouldSuppressProgrammaticSubmit as shouldSuppressProgrammaticSubmitEntry,
  type RecentProgrammaticSubmitState,
} from './submit-memory';
import {
  rememberSubmitFingerprint,
  shouldSkipDuplicateSubmit,
} from './submit-fingerprint';
import {
  isSubmissionSuppressed,
  suppressObservedSubmissions,
  type SubmitSuppressionState,
} from './submit-suppression';
import type { UiContext } from './ui';
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
  const viewRuntime: {
    uiContext: UiContext;
    workspaceSummary: WorkspaceSummary | null;
    hasHydratedPresence: boolean;
    standaloneCreateSetTouched: boolean;
  } = {
    uiContext: {
      workspaceId: null,
      providerEnabled: true,
      globalSyncEnabled: true,
      standaloneReady: false,
      standaloneCreateSetEnabled: true,
      canStartNewSet: true,
      shortcuts: DEFAULT_SHORTCUTS,
    },
    workspaceSummary: null,
    hasHydratedPresence: false,
    standaloneCreateSetTouched: false,
  };
  const syncRuntime: {
    syncProgress: SyncProgressSnapshot | null;
    pendingSyncProgress: SyncProgressSnapshot | null;
  } = {
    syncProgress: null,
    pendingSyncProgress: null,
  };
  const submitRuntime: SubmitSuppressionState &
    RecentProgrammaticSubmitState & {
      lastFingerprint: string;
      lastFingerprintAt: number;
    } = {
    suppressSubmissionsUntil: 0,
    lastFingerprint: '',
    lastFingerprintAt: 0,
    recentProgrammaticSubmits: new Map<string, number>(),
  };

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
    viewRuntime.standaloneCreateSetTouched = true;
    viewRuntime.uiContext = {
      ...viewRuntime.uiContext,
      standaloneCreateSetEnabled: nextEnabled,
    };
    ui.setContext(viewRuntime.uiContext);
  };

  const setProviderEnabled = (nextEnabled: boolean) => {
    viewRuntime.uiContext = {
      ...viewRuntime.uiContext,
      providerEnabled: nextEnabled,
    };
    ui.setContext(viewRuntime.uiContext);
  };

  const applyPresenceResponse = (response: PresenceResponse | null) => {
    const transition = buildPresenceContextTransition({
      currentContext: viewRuntime.uiContext,
      response,
      standaloneVisible: shouldShowStandaloneIndicator(adapter),
      hasHydratedPresence: viewRuntime.hasHydratedPresence,
      standaloneCreateSetTouched: viewRuntime.standaloneCreateSetTouched,
    });

    viewRuntime.workspaceSummary = transition.workspaceSummary;
    viewRuntime.uiContext = transition.uiContext;
    viewRuntime.standaloneCreateSetTouched = transition.standaloneCreateSetTouched;
    viewRuntime.hasHydratedPresence = transition.hasHydratedPresence;
    ui.setContext(viewRuntime.uiContext);
    ui.setVisible(transition.visible);
  };

  const applySubmitResponse = (response: SubmitResponse | null) => {
    const transition = buildSubmitContextTransition({
      currentContext: viewRuntime.uiContext,
      response,
      standaloneVisible: shouldShowStandaloneIndicator(adapter),
    });

    viewRuntime.workspaceSummary = transition.workspaceSummary;
    viewRuntime.uiContext = transition.uiContext;
    ui.setContext(viewRuntime.uiContext);
    ui.setVisible(transition.visible);
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
    rememberProgrammaticSubmitEntry(
      submitRuntime,
      content,
    );
  };

  const shouldSuppressProgrammaticSubmit = (content: string) => {
    return shouldSuppressProgrammaticSubmitEntry(
      submitRuntime,
      content,
    );
  };

  return {
    getUiContext: () => viewRuntime.uiContext,
    hasHydratedPresence: () => viewRuntime.hasHydratedPresence,
    getWorkspaceSummary: () => viewRuntime.workspaceSummary,
    setWorkspaceSummary: (nextSummary: WorkspaceSummary | null) => {
      viewRuntime.workspaceSummary = nextSummary;
    },
    isSubmissionSuppressed: (now = Date.now()) => isSubmissionSuppressed(submitRuntime, now),
    shouldSkipDuplicateSubmit(fingerprint: string, now = Date.now()) {
      return shouldSkipDuplicateSubmit(
        {
          lastFingerprint: submitRuntime.lastFingerprint,
          lastFingerprintAt: submitRuntime.lastFingerprintAt,
        },
        fingerprint,
        now,
      );
    },
    rememberSubmitFingerprint(fingerprint: string, now = Date.now()) {
      const state = {
        lastFingerprint: submitRuntime.lastFingerprint,
        lastFingerprintAt: submitRuntime.lastFingerprintAt,
      };
      rememberSubmitFingerprint(state, fingerprint, now);
      submitRuntime.lastFingerprint = state.lastFingerprint;
      submitRuntime.lastFingerprintAt = state.lastFingerprintAt;
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
      suppressObservedSubmissions(submitRuntime, durationMs, now);
    },
  };
}

export type ContentStateController = ReturnType<typeof createContentState>;
