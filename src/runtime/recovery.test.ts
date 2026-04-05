import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionState, Workspace } from './protocol';
import { reconcileClaimedTabsWithBrowser, resolveDeliveryTarget } from './recovery';

describe('recovery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reuses a stale claimed tab when ping succeeds with the expected session', async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      provider: 'deepseek',
      currentUrl: 'https://chat.deepseek.com/a/chat/s/d-1',
      sessionId: 'd-1',
      pageState: 'ready',
      pageKind: 'existing-session',
    });

    vi.stubGlobal('chrome', {
      tabs: {
        sendMessage,
      },
    });

    const workspace: Workspace = {
      id: 'w1',
      members: {
        deepseek: {
          provider: 'deepseek',
          sessionId: 'd-1',
          url: 'https://chat.deepseek.com/a/chat/s/d-1',
        },
      },
      enabledProviders: ['deepseek'],
      createdAt: 1,
      updatedAt: 1,
    };

    const sessionState: SessionState = {
      claimedTabs: {
        'w1:deepseek': {
          provider: 'deepseek',
          workspaceId: 'w1',
          tabId: 9,
          currentUrl: 'https://chat.deepseek.com/a/chat/s/d-1',
          sessionId: 'd-1',
          pageState: 'ready',
          lastSeenAt: Date.now() - 240_001,
        },
      },
    };

    const target = await resolveDeliveryTarget(workspace, 'deepseek', sessionState);

    expect(sendMessage).toHaveBeenCalledWith(9, { type: 'PING' });
    expect(target).toMatchObject({
      tabId: 9,
      expectedSessionId: 'd-1',
      expectedUrl: 'https://chat.deepseek.com/a/chat/s/d-1',
      resolution: 'reuse-claimed-tab',
    });
    expect(target.reason).toContain('stale claimed tab responded ready');
  });

  it('removes claimed tabs whose browser tabs no longer exist', async () => {
    const get = vi.fn().mockRejectedValue(new Error('No tab with id: 9'));

    vi.stubGlobal('chrome', {
      tabs: {
        get,
      },
    });

    const sessionState: SessionState = {
      claimedTabs: {
        'w1:deepseek': {
          provider: 'deepseek',
          workspaceId: 'w1',
          tabId: 9,
          currentUrl: 'https://chat.deepseek.com/a/chat/s/d-1',
          sessionId: 'd-1',
          pageState: 'ready',
          lastSeenAt: Date.now(),
        },
      },
    };

    const result = await reconcileClaimedTabsWithBrowser(sessionState);

    expect(get).toHaveBeenCalledWith(9);
    expect(result.removedClaimedTabs).toHaveLength(1);
    expect(result.sessionState.claimedTabs).toEqual({});
  });
});
