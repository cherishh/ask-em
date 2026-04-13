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
} from './submit-memory';
import {
  rememberSubmitFingerprint,
  shouldSkipDuplicateSubmit,
} from './submit-fingerprint';
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

  const syncPendingProgress = () => {
    const nextState = reconcileSyncProgressForWorkspace(
      {
        syncProgress,
        pendingSyncProgress,
      },
      uiContext.workspaceId,
    );
    syncProgress = nextState.syncProgress;
    pendingSyncProgress = nextState.pendingSyncProgress;
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
    const transition = buildPresenceContextTransition({
      currentContext: uiContext,
      response,
      standaloneVisible: shouldShowStandaloneIndicator(adapter),
      hasHydratedPresence,
      standaloneCreateSetTouched,
    });

    workspaceSummary = transition.workspaceSummary;
    uiContext = transition.uiContext;
    standaloneCreateSetTouched = transition.standaloneCreateSetTouched;
    hasHydratedPresence = transition.hasHydratedPresence;
    ui.setContext(uiContext);
    ui.setVisible(transition.visible);
  };

  const applySubmitResponse = (response: SubmitResponse | null) => {
    const transition = buildSubmitContextTransition({
      currentContext: uiContext,
      response,
      standaloneVisible: shouldShowStandaloneIndicator(adapter),
    });

    workspaceSummary = transition.workspaceSummary;
    uiContext = transition.uiContext;
    ui.setContext(uiContext);
    ui.setVisible(transition.visible);
    syncProgress = null;
  };

  const handleSyncProgress = (progress: SyncProgressSnapshot) => {
    const nextState = applyIncomingSyncProgress(
      {
        syncProgress,
        pendingSyncProgress,
      },
      uiContext.workspaceId,
      progress,
    );
    syncProgress = nextState.syncProgress;
    pendingSyncProgress = nextState.pendingSyncProgress;

    if (uiContext.workspaceId === progress.workspaceId) {
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
      { recentProgrammaticSubmits },
      content,
    );
  };

  const shouldSuppressProgrammaticSubmit = (content: string) => {
    return shouldSuppressProgrammaticSubmitEntry(
      { recentProgrammaticSubmits },
      content,
    );
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
    shouldSkipDuplicateSubmit(fingerprint: string, now = Date.now()) {
      return shouldSkipDuplicateSubmit(
        {
          lastFingerprint,
          lastFingerprintAt,
        },
        fingerprint,
        now,
      );
    },
    rememberSubmitFingerprint(fingerprint: string, now = Date.now()) {
      const state = {
        lastFingerprint,
        lastFingerprintAt,
      };
      rememberSubmitFingerprint(state, fingerprint, now);
      lastFingerprint = state.lastFingerprint;
      lastFingerprintAt = state.lastFingerprintAt;
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
