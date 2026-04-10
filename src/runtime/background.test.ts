import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalState, SessionState } from './protocol';

const storageMocks = vi.hoisted(() => ({
  appendDebugLog: vi.fn().mockResolvedValue(undefined),
  clearClaimedTab: vi.fn(),
  clearDebugLogs: vi.fn(),
  getLocalState: vi.fn(),
  getSessionState: vi.fn(),
  setLocalState: vi.fn(),
  setSessionState: vi.fn(),
  upsertClaimedTab: vi.fn(),
}));

vi.mock('./storage', () => storageMocks);

function createLocalState(): LocalState {
  return {
    globalSyncEnabled: true,
    debugLoggingEnabled: false,
    defaultEnabledProviders: {
      claude: true,
      chatgpt: true,
      gemini: true,
      deepseek: true,
    },
    shortcuts: { toggleProviderSync: { key: '.', meta: false, ctrl: true, shift: false, alt: false }, toggleGlobalSync: { key: '.', meta: false, ctrl: true, shift: true, alt: false } },
    workspaces: {},
    workspaceIndex: {},
    debugLogs: [],
  };
}

describe('background new-chat detachment', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal('defineBackground', vi.fn((callback: unknown) => callback));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detaches the claimed tab but keeps the previous member binding intact', async () => {
    const localState: LocalState = {
      ...createLocalState(),
      workspaces: {
        w1: {
          id: 'w1',
          members: {
            claude: {
              provider: 'claude',
              sessionId: 'c-1',
              url: 'https://claude.ai/chat/c-1',
            },
            chatgpt: {
              provider: 'chatgpt',
              sessionId: 'g-1',
              url: 'https://chatgpt.com/c/g-1',
            },
          },
          enabledProviders: ['claude', 'chatgpt'],
          createdAt: 1,
          updatedAt: 1,
        },
      },
      workspaceIndex: {
        'claude:c-1': 'w1',
        'chatgpt:g-1': 'w1',
      },
    };

    const sessionState: SessionState = {
      claimedTabs: {
        'w1:claude': {
          provider: 'claude',
          workspaceId: 'w1',
          tabId: 9,
          currentUrl: 'https://claude.ai/chat/c-1',
          sessionId: 'c-1',
          pageState: 'ready',
          lastSeenAt: 10,
        },
        'w1:chatgpt': {
          provider: 'chatgpt',
          workspaceId: 'w1',
          tabId: 10,
          currentUrl: 'https://chatgpt.com/c/g-1',
          sessionId: 'g-1',
          pageState: 'ready',
          lastSeenAt: 10,
        },
      },
    };

    const nextSessionState: SessionState = {
      claimedTabs: {
        'w1:chatgpt': sessionState.claimedTabs['w1:chatgpt'],
      },
    };

    storageMocks.clearClaimedTab.mockResolvedValue(nextSessionState);
    storageMocks.getSessionState.mockResolvedValue(nextSessionState);

    const { detachClaimedTabForNewChat } = await import('../entrypoints/background');
    const result = await detachClaimedTabForNewChat(
      localState,
      sessionState,
      9,
      'claude',
      'https://claude.ai/new',
      'Detached claimed tab from previous group on new-chat navigation',
    );

    expect(storageMocks.clearClaimedTab).toHaveBeenCalledWith('w1', 'claude');
    expect(storageMocks.appendDebugLog).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'w1',
        provider: 'claude',
        message: 'Detached claimed tab from previous group on new-chat navigation',
      }),
    );
    expect(localState.workspaces.w1.members.claude?.sessionId).toBe('c-1');
    expect(localState.workspaces.w1.enabledProviders).toContain('claude');
    expect(result).toEqual({
      sessionState: nextSessionState,
      detachedWorkspaceId: 'w1',
    });
  });

  it('does not detach the pending source tab before its first session is bound', async () => {
    const localState: LocalState = {
      ...createLocalState(),
      workspaces: {
        w1: {
          id: 'w1',
          members: {
            claude: {
              provider: 'claude',
              sessionId: null,
              url: 'https://claude.ai/new',
            },
          },
          enabledProviders: ['claude'],
          createdAt: 1,
          updatedAt: 1,
          pendingSource: 'claude',
        },
      },
    };

    const sessionState: SessionState = {
      claimedTabs: {
        'w1:claude': {
          provider: 'claude',
          workspaceId: 'w1',
          tabId: 9,
          currentUrl: 'https://claude.ai/new',
          sessionId: null,
          pageState: 'ready',
          lastSeenAt: 10,
        },
      },
    };

    const { detachClaimedTabForNewChat } = await import('../entrypoints/background');
    const result = await detachClaimedTabForNewChat(
      localState,
      sessionState,
      9,
      'claude',
      'https://claude.ai/new',
      'Detached claimed tab from previous group on new-chat navigation',
    );

    expect(storageMocks.clearClaimedTab).not.toHaveBeenCalled();
    expect(storageMocks.appendDebugLog).not.toHaveBeenCalled();
    expect(result).toEqual({
      sessionState,
      detachedWorkspaceId: null,
    });
  });

  it('does not detach a target tab that has not bound a session yet', async () => {
    const localState: LocalState = {
      ...createLocalState(),
      workspaces: {
        w1: {
          id: 'w1',
          members: {
            claude: {
              provider: 'claude',
              sessionId: 'c-1',
              url: 'https://claude.ai/chat/c-1',
            },
            gemini: {
              provider: 'gemini',
              sessionId: null,
              url: 'https://gemini.google.com/app',
            },
          },
          enabledProviders: ['claude', 'gemini'],
          createdAt: 1,
          updatedAt: 1,
        },
      },
      workspaceIndex: {
        'claude:c-1': 'w1',
      },
    };

    const sessionState: SessionState = {
      claimedTabs: {
        'w1:gemini': {
          provider: 'gemini',
          workspaceId: 'w1',
          tabId: 12,
          currentUrl: 'https://gemini.google.com/app',
          sessionId: null,
          pageState: 'ready',
          lastSeenAt: 10,
        },
      },
    };

    const { detachClaimedTabForNewChat } = await import('../entrypoints/background');
    const result = await detachClaimedTabForNewChat(
      localState,
      sessionState,
      12,
      'gemini',
      'https://gemini.google.com/app',
      'Detached claimed tab from previous group on new-chat navigation',
    );

    expect(storageMocks.clearClaimedTab).not.toHaveBeenCalled();
    expect(storageMocks.appendDebugLog).not.toHaveBeenCalled();
    expect(result).toEqual({
      sessionState,
      detachedWorkspaceId: null,
    });
  });
});
