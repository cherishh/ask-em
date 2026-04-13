import type { SyncProgressSnapshot } from './indicator';

export type ContentSyncProgressState = {
  syncProgress: SyncProgressSnapshot | null;
  pendingSyncProgress: SyncProgressSnapshot | null;
};

export function reconcileSyncProgressForWorkspace(
  state: ContentSyncProgressState,
  workspaceId: string | null,
): ContentSyncProgressState {
  if (state.pendingSyncProgress && state.pendingSyncProgress.workspaceId === workspaceId) {
    return {
      syncProgress:
        state.pendingSyncProgress.completed < state.pendingSyncProgress.total
          ? state.pendingSyncProgress
          : null,
      pendingSyncProgress: null,
    };
  }

  if (state.syncProgress && state.syncProgress.workspaceId !== workspaceId) {
    return {
      syncProgress: null,
      pendingSyncProgress: state.pendingSyncProgress,
    };
  }

  return state;
}

export function applyIncomingSyncProgress(
  state: ContentSyncProgressState,
  workspaceId: string | null,
  progress: SyncProgressSnapshot,
): ContentSyncProgressState {
  if (workspaceId === progress.workspaceId) {
    return {
      syncProgress: progress.completed < progress.total ? progress : null,
      pendingSyncProgress: null,
    };
  }

  return {
    syncProgress: state.syncProgress,
    pendingSyncProgress: progress,
  };
}
