import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLocalState, makeSessionState, makeWorkspace } from '../test/builders';
import { persistPresenceObservation } from './presence-persistence';

const storageMocks = vi.hoisted(() => ({
  setLocalState: vi.fn(),
  upsertClaimedTab: vi.fn(),
}));

vi.mock('../runtime/storage', () => storageMocks);
vi.mock('./debug', () => ({
  logDebug: vi.fn(),
}));

describe('persistPresenceObservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not overwrite the workspace member URL when a read-only Manus report is open', async () => {
    const localState = makeLocalState({
      workspaces: {
        w1: makeWorkspace({
          id: 'w1',
          enabledProviders: ['manus'],
          members: {
            manus: {
              provider: 'manus',
              sessionId: 'm-1',
              url: 'https://manus.im/app/m-1',
            },
          },
        }),
      },
      workspaceIndex: {
        'manus:m-1': 'w1',
      },
    });

    const nextLocalState = await persistPresenceObservation({
      localState,
      sessionState: makeSessionState(),
      workspaceId: 'w1',
      tabId: 42,
      message: {
        type: 'HEARTBEAT',
        provider: 'manus',
        currentUrl: 'https://manus.im/app/m-1?previewEventId=e&previewSandboxPath=%2Fhome%2Fubuntu%2Freport.md',
        sessionId: 'm-1',
        pageKind: 'existing-session',
        pageState: 'read-only',
        timestamp: 100,
      },
    });

    expect(nextLocalState.workspaces.w1.members.manus?.url).toBe('https://manus.im/app/m-1');
    expect(storageMocks.setLocalState).not.toHaveBeenCalled();
    expect(storageMocks.upsertClaimedTab).toHaveBeenCalledWith(
      'w1',
      'manus',
      expect.objectContaining({
        currentUrl: 'https://manus.im/app/m-1?previewEventId=e&previewSandboxPath=%2Fhome%2Fubuntu%2Freport.md',
        pageState: 'read-only',
        sessionId: 'm-1',
      }),
    );
  });
});
