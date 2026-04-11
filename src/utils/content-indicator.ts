import type { GroupMemberState, PageState, WorkspaceSummary } from '../runtime/protocol';

export type IndicatorUiState = 'idle' | 'blocked' | 'syncing';

export type SyncIndicatorTone = 'neutral' | 'success' | 'warning';

export type IndicatorAlertLevel = 'normal' | 'set-warning' | 'current-warning';

export type SyncProgressSnapshot = {
  workspaceId: string;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
};

export type ContentIndicatorInput = {
  hasWorkspace: boolean;
  globalSyncEnabled: boolean;
  providerEnabled: boolean;
  standaloneReady: boolean;
  standaloneCreateSetEnabled: boolean;
  canStartNewSet: boolean;
  pageState: PageState;
  workspaceSummary: WorkspaceSummary | null;
  syncProgress: SyncProgressSnapshot | null;
};

export type ContentIndicatorPresentation = {
  state: IndicatorUiState;
  label: string;
  syncLabel: string;
  syncTone: SyncIndicatorTone;
  alertLevel: IndicatorAlertLevel;
};

function formatModelCount(count: number): string {
  return `${count} ${count === 1 ? 'model' : 'models'}`;
}

function formatAttentionCount(count: number): string {
  return `${count} ${count === 1 ? 'model needs attention' : 'models need attention'}`;
}

function isWarningMemberState(state: GroupMemberState | undefined) {
  return state === 'login-required' || state === 'not-ready';
}

export function countWorkspaceIssues(summary: WorkspaceSummary | null): number {
  if (!summary) {
    return 0;
  }

  return summary.workspace.enabledProviders.filter((provider) =>
    isWarningMemberState(summary.memberStates[provider]),
  ).length;
}

function getCurrentTabLabel(input: ContentIndicatorInput): string {
  if (!input.hasWorkspace) {
    if (input.pageState === 'login-required') {
      return 'needs login';
    }

    if (input.pageState === 'not-ready') {
      return 'loading';
    }

    return 'ready';
  }

  if (!input.globalSyncEnabled || !input.providerEnabled) {
    return 'current model sync paused';
  }

  if (input.pageState === 'login-required') {
    return 'current model needs login';
  }

  if (input.pageState === 'not-ready') {
    return 'current model is loading';
  }

  return 'current model is in sync';
}

function getStandaloneSyncStatus(input: ContentIndicatorInput) {
  if (!input.globalSyncEnabled) {
    return {
      label: 'next prompt stays here',
      tone: 'neutral' as const,
    };
  }

  if (!input.canStartNewSet) {
    return {
      label: 'set limit reached',
      tone: 'warning' as const,
    };
  }

  return {
    label: input.standaloneCreateSetEnabled ? 'next prompt will fan out' : 'next prompt stays here',
    tone: 'neutral' as const,
  };
}

function hasActiveProgress(input: ContentIndicatorInput) {
  return Boolean(input.syncProgress && input.syncProgress.total > 0);
}

function getProgressSyncStatus(progress: SyncProgressSnapshot) {
  if (progress.completed === 0) {
    return {
      label: `syncing ${formatModelCount(progress.total)}`,
      tone: 'neutral' as const,
    };
  }

  if (progress.failed > 0) {
    return {
      label: `${progress.succeeded} of ${progress.total} synced`,
      tone: 'warning' as const,
    };
  }

  return {
    label: `${progress.succeeded} of ${progress.total} synced`,
    tone: 'neutral' as const,
  };
}

function getWorkspaceSyncStatus(input: ContentIndicatorInput) {
  if (!input.globalSyncEnabled) {
    return {
      label: 'sync paused',
      tone: 'neutral' as const,
    };
  }

  if (!input.providerEnabled) {
    return {
      label: 'this tab is paused',
      tone: 'neutral' as const,
    };
  }

  const issueCount = countWorkspaceIssues(input.workspaceSummary);
  if (issueCount > 0) {
    return {
      label: formatAttentionCount(issueCount),
      tone: 'warning' as const,
    };
  }

  return {
    label: 'all models synced',
    tone: 'neutral' as const,
  };
}

function getIndicatorAlertLevel(input: ContentIndicatorInput): IndicatorAlertLevel {
  if (
    input.hasWorkspace &&
    input.globalSyncEnabled &&
    input.providerEnabled &&
    input.pageState !== 'ready'
  ) {
    return 'current-warning';
  }

  if (hasActiveProgress(input)) {
    return input.syncProgress!.failed > 0 ? 'set-warning' : 'normal';
  }

  if (input.hasWorkspace && countWorkspaceIssues(input.workspaceSummary) > 0) {
    return 'set-warning';
  }

  return 'normal';
}

function getIndicatorState(input: ContentIndicatorInput): IndicatorUiState {
  if (
    input.hasWorkspace &&
    input.globalSyncEnabled &&
    input.providerEnabled &&
    input.pageState !== 'ready'
  ) {
    return 'blocked';
  }

  if (hasActiveProgress(input)) {
    return 'syncing';
  }

  if (!input.hasWorkspace) {
    if (
      input.standaloneReady &&
      (!input.globalSyncEnabled || !input.canStartNewSet || !input.standaloneCreateSetEnabled)
    ) {
      return 'blocked';
    }

    return 'idle';
  }

  if (!input.globalSyncEnabled || !input.providerEnabled) {
    return 'blocked';
  }

  return 'idle';
}

export function getContentIndicatorPresentation(
  input: ContentIndicatorInput,
): ContentIndicatorPresentation {
  const syncStatus = !input.hasWorkspace
    ? getStandaloneSyncStatus(input)
    : hasActiveProgress(input)
      ? getProgressSyncStatus(input.syncProgress!)
      : getWorkspaceSyncStatus(input);

  return {
    state: getIndicatorState(input),
    label: getCurrentTabLabel(input),
    syncLabel: syncStatus.label,
    syncTone: syncStatus.tone,
    alertLevel: getIndicatorAlertLevel(input),
  };
}
