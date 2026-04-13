import { describe, expect, it } from 'vitest';
import {
  applyIncomingSyncProgress,
  reconcileSyncProgressForWorkspace,
} from './sync-progress';

describe('content sync progress helpers', () => {
  it('applies matching workspace progress as active sync progress', () => {
    expect(
      applyIncomingSyncProgress(
        {
          syncProgress: null,
          pendingSyncProgress: null,
        },
        'w1',
        {
          workspaceId: 'w1',
          total: 3,
          completed: 1,
          succeeded: 1,
          failed: 0,
        },
      ),
    ).toEqual({
      syncProgress: {
        workspaceId: 'w1',
        total: 3,
        completed: 1,
        succeeded: 1,
        failed: 0,
      },
      pendingSyncProgress: null,
    });
  });

  it('stores foreign workspace progress as pending', () => {
    expect(
      applyIncomingSyncProgress(
        {
          syncProgress: null,
          pendingSyncProgress: null,
        },
        'w1',
        {
          workspaceId: 'w2',
          total: 2,
          completed: 1,
          succeeded: 1,
          failed: 0,
        },
      ),
    ).toEqual({
      syncProgress: null,
      pendingSyncProgress: {
        workspaceId: 'w2',
        total: 2,
        completed: 1,
        succeeded: 1,
        failed: 0,
      },
    });
  });

  it('reconciles pending progress when the workspace becomes current', () => {
    expect(
      reconcileSyncProgressForWorkspace(
        {
          syncProgress: null,
          pendingSyncProgress: {
            workspaceId: 'w1',
            total: 2,
            completed: 1,
            succeeded: 1,
            failed: 0,
          },
        },
        'w1',
      ),
    ).toEqual({
      syncProgress: {
        workspaceId: 'w1',
        total: 2,
        completed: 1,
        succeeded: 1,
        failed: 0,
      },
      pendingSyncProgress: null,
    });
  });

  it('drops completed pending progress when reconciling', () => {
    expect(
      reconcileSyncProgressForWorkspace(
        {
          syncProgress: null,
          pendingSyncProgress: {
            workspaceId: 'w1',
            total: 2,
            completed: 2,
            succeeded: 2,
            failed: 0,
          },
        },
        'w1',
      ),
    ).toEqual({
      syncProgress: null,
      pendingSyncProgress: null,
    });
  });
});
