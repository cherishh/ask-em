import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SHORTCUTS } from './protocol';
import type { LocalState, SessionState, UserSubmitMessage } from './protocol';

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
    shortcuts: DEFAULT_SHORTCUTS,
    workspaces: {},
    workspaceIndex: {},
    debugLogs: [],
  };
}

function createSubmitMessage(overrides: Partial<UserSubmitMessage> = {}): UserSubmitMessage {
  return {
    type: 'USER_SUBMIT',
    provider: 'claude',
    currentUrl: 'https://claude.ai/chat/c-set',
    sessionId: 'c-set',
    pageKind: 'existing-session',
    content: 'hello',
    timestamp: 100,
    ...overrides,
  };
}

describe('background new-chat detachment', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal('defineBackground', vi.fn((callback: unknown) => callback));
    vi.stubGlobal('chrome', {
      tabs: {
        get: vi.fn().mockResolvedValue({ id: 9 }),
        sendMessage: vi.fn().mockResolvedValue({ ok: true }),
        update: vi.fn().mockResolvedValue({ id: 10, windowId: 3 }),
        query: vi.fn().mockResolvedValue([]),
        onRemoved: { addListener: vi.fn() },
      },
      windows: {
        update: vi.fn().mockResolvedValue({ id: 3 }),
      },
    });
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

  it('detaches a claimed tab when it navigates to an existing session outside the workspace', async () => {
    const localState: LocalState = {
      ...createLocalState(),
      workspaces: {
        w1: {
          id: 'w1',
          members: {
            claude: {
              provider: 'claude',
              sessionId: 'c-set',
              url: 'https://claude.ai/chat/c-set',
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
        'claude:c-set': 'w1',
        'chatgpt:g-1': 'w1',
      },
    };

    const sessionState: SessionState = {
      claimedTabs: {
        'w1:claude': {
          provider: 'claude',
          workspaceId: 'w1',
          tabId: 9,
          currentUrl: 'https://claude.ai/chat/c-set',
          sessionId: 'c-set',
          pageState: 'ready',
          lastSeenAt: 10,
        },
      },
    };

    const nextSessionState: SessionState = {
      claimedTabs: {},
    };

    storageMocks.clearClaimedTab.mockResolvedValue(nextSessionState);
    storageMocks.getSessionState.mockResolvedValue(nextSessionState);

    const { detachClaimedTabForForeignSession } = await import('../entrypoints/background');
    const result = await detachClaimedTabForForeignSession(
      localState,
      sessionState,
      9,
      'claude',
      'c-old',
      'Detached claimed tab from previous group on existing-session navigation',
    );

    expect(storageMocks.clearClaimedTab).toHaveBeenCalledWith('w1', 'claude');
    expect(storageMocks.appendDebugLog).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'w1',
        provider: 'claude',
        message: 'Detached claimed tab from previous group on existing-session navigation',
        detail: 'c-set -> c-old',
      }),
    );
    expect(localState.workspaces.w1.members.claude?.sessionId).toBe('c-set');
    expect(result).toEqual({
      sessionState: nextSessionState,
      detachedWorkspaceId: 'w1',
    });
  });

  it('does not detach a claimed tab that is still on its bound session', async () => {
    const localState: LocalState = {
      ...createLocalState(),
      workspaces: {
        w1: {
          id: 'w1',
          members: {
            claude: {
              provider: 'claude',
              sessionId: 'c-set',
              url: 'https://claude.ai/chat/c-set',
            },
          },
          enabledProviders: ['claude'],
          createdAt: 1,
          updatedAt: 1,
        },
      },
      workspaceIndex: {
        'claude:c-set': 'w1',
      },
    };

    const sessionState: SessionState = {
      claimedTabs: {
        'w1:claude': {
          provider: 'claude',
          workspaceId: 'w1',
          tabId: 9,
          currentUrl: 'https://claude.ai/chat/c-set',
          sessionId: 'c-set',
          pageState: 'ready',
          lastSeenAt: 10,
        },
      },
    };

    const { detachClaimedTabForForeignSession } = await import('../entrypoints/background');
    const result = await detachClaimedTabForForeignSession(
      localState,
      sessionState,
      9,
      'claude',
      'c-set',
      'Detached claimed tab from previous group on existing-session navigation',
    );

    expect(storageMocks.clearClaimedTab).not.toHaveBeenCalled();
    expect(result).toEqual({
      sessionState,
      detachedWorkspaceId: null,
    });
  });

  it('does not detach an unbound target when it receives its first session', async () => {
    const localState: LocalState = {
      ...createLocalState(),
      workspaces: {
        w1: {
          id: 'w1',
          members: {
            claude: {
              provider: 'claude',
              sessionId: 'c-set',
              url: 'https://claude.ai/chat/c-set',
            },
          },
          enabledProviders: ['claude', 'deepseek'],
          createdAt: 1,
          updatedAt: 1,
        },
      },
      workspaceIndex: {
        'claude:c-set': 'w1',
      },
    };

    const sessionState: SessionState = {
      claimedTabs: {
        'w1:deepseek': {
          provider: 'deepseek',
          workspaceId: 'w1',
          tabId: 11,
          currentUrl: 'https://chat.deepseek.com/',
          sessionId: null,
          pageState: 'ready',
          lastSeenAt: 10,
        },
      },
    };

    const { detachClaimedTabForForeignSession } = await import('../entrypoints/background');
    const result = await detachClaimedTabForForeignSession(
      localState,
      sessionState,
      11,
      'deepseek',
      'd-first',
      'Detached claimed tab from previous group on existing-session navigation',
    );

    expect(storageMocks.clearClaimedTab).not.toHaveBeenCalled();
    expect(result).toEqual({
      sessionState,
      detachedWorkspaceId: null,
    });
  });

  it('does not fan out when submit comes from a claimed tab on an unrelated existing session', async () => {
    const localState: LocalState = {
      ...createLocalState(),
      workspaces: {
        w1: {
          id: 'w1',
          members: {
            claude: {
              provider: 'claude',
              sessionId: 'c-set',
              url: 'https://claude.ai/chat/c-set',
            },
            chatgpt: {
              provider: 'chatgpt',
              sessionId: 'g-set',
              url: 'https://chatgpt.com/c/g-set',
            },
          },
          enabledProviders: ['claude', 'chatgpt'],
          createdAt: 1,
          updatedAt: 1,
        },
      },
      workspaceIndex: {
        'claude:c-set': 'w1',
        'chatgpt:g-set': 'w1',
      },
    };

    const sessionState: SessionState = {
      claimedTabs: {
        'w1:claude': {
          provider: 'claude',
          workspaceId: 'w1',
          tabId: 9,
          currentUrl: 'https://claude.ai/chat/c-set',
          sessionId: 'c-set',
          pageState: 'ready',
          lastSeenAt: 10,
        },
      },
    };

    storageMocks.getLocalState.mockResolvedValue(localState);
    storageMocks.getSessionState.mockResolvedValue(sessionState);
    storageMocks.clearClaimedTab.mockResolvedValue({ claimedTabs: {} });

    const { handleUserSubmit } = await import('../entrypoints/background');
    const result = await handleUserSubmit(
      createSubmitMessage({
        currentUrl: 'https://claude.ai/chat/c-old',
        sessionId: 'c-old',
        content: 'old session prompt',
      }),
      { tab: { id: 9 } } as chrome.runtime.MessageSender,
    );

    expect(storageMocks.clearClaimedTab).toHaveBeenCalledWith('w1', 'claude');
    expect(storageMocks.upsertClaimedTab).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        synced: false,
        workspaceId: null,
      }),
    );
  });

  it('routes a claimed tab to the matching workspace when the existing session belongs to another group', async () => {
    const localState: LocalState = {
      ...createLocalState(),
      workspaces: {
        w1: {
          id: 'w1',
          members: {
            claude: {
              provider: 'claude',
              sessionId: 'c-a',
              url: 'https://claude.ai/chat/c-a',
            },
          },
          enabledProviders: ['claude'],
          createdAt: 1,
          updatedAt: 1,
        },
        w2: {
          id: 'w2',
          members: {
            claude: {
              provider: 'claude',
              sessionId: 'c-b',
              url: 'https://claude.ai/chat/c-b',
            },
          },
          enabledProviders: ['claude'],
          createdAt: 2,
          updatedAt: 2,
        },
      },
      workspaceIndex: {
        'claude:c-a': 'w1',
        'claude:c-b': 'w2',
      },
    };

    const sessionState: SessionState = {
      claimedTabs: {
        'w1:claude': {
          provider: 'claude',
          workspaceId: 'w1',
          tabId: 9,
          currentUrl: 'https://claude.ai/chat/c-a',
          sessionId: 'c-a',
          pageState: 'ready',
          lastSeenAt: 10,
        },
      },
    };

    storageMocks.getLocalState.mockResolvedValue(localState);
    storageMocks.getSessionState.mockResolvedValue(sessionState);
    storageMocks.clearClaimedTab.mockResolvedValue({ claimedTabs: {} });

    const { handleUserSubmit } = await import('../entrypoints/background');
    const result = await handleUserSubmit(
      createSubmitMessage({
        currentUrl: 'https://claude.ai/chat/c-b',
        sessionId: 'c-b',
        content: 'workspace b prompt',
      }),
      { tab: { id: 9 } } as chrome.runtime.MessageSender,
    );

    expect(storageMocks.clearClaimedTab).toHaveBeenCalledWith('w1', 'claude');
    expect(storageMocks.upsertClaimedTab).toHaveBeenCalledWith(
      'w2',
      'claude',
      expect.objectContaining({
        workspaceId: 'w2',
        provider: 'claude',
        tabId: 9,
        sessionId: 'c-b',
      }),
    );
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        synced: true,
        workspaceId: 'w2',
      }),
    );
  });

  it('does not fan out from a claimed existing-session page when the session id cannot be resolved', async () => {
    const localState: LocalState = {
      ...createLocalState(),
      workspaces: {
        w1: {
          id: 'w1',
          members: {
            claude: {
              provider: 'claude',
              sessionId: 'c-set',
              url: 'https://claude.ai/chat/c-set',
            },
            deepseek: {
              provider: 'deepseek',
              sessionId: 'd-set',
              url: 'https://chat.deepseek.com/a/chat/s/d-set',
            },
          },
          enabledProviders: ['claude', 'deepseek'],
          createdAt: 1,
          updatedAt: 1,
        },
      },
      workspaceIndex: {
        'claude:c-set': 'w1',
        'deepseek:d-set': 'w1',
      },
    };

    const sessionState: SessionState = {
      claimedTabs: {
        'w1:claude': {
          provider: 'claude',
          workspaceId: 'w1',
          tabId: 9,
          currentUrl: 'https://claude.ai/chat/c-set',
          sessionId: 'c-set',
          pageState: 'ready',
          lastSeenAt: 10,
        },
      },
    };

    storageMocks.getLocalState.mockResolvedValue(localState);
    storageMocks.getSessionState.mockResolvedValue(sessionState);
    storageMocks.clearClaimedTab.mockResolvedValue({ claimedTabs: {} });

    const { handleUserSubmit } = await import('../entrypoints/background');
    const result = await handleUserSubmit(
      createSubmitMessage({
        currentUrl: 'https://claude.ai/chat/unknown',
        sessionId: null,
        pageKind: 'existing-session',
        content: 'unresolved session prompt',
      }),
      { tab: { id: 9 } } as chrome.runtime.MessageSender,
    );

    expect(storageMocks.clearClaimedTab).toHaveBeenCalledWith('w1', 'claude');
    expect(storageMocks.upsertClaimedTab).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        synced: false,
        workspaceId: null,
      }),
    );
  });

  it('keeps routing when the same bound session is seen at a changed url', async () => {
    const localState: LocalState = {
      ...createLocalState(),
      workspaces: {
        w1: {
          id: 'w1',
          members: {
            claude: {
              provider: 'claude',
              sessionId: 'c-set',
              url: 'https://claude.ai/chat/c-set',
            },
          },
          enabledProviders: ['claude'],
          createdAt: 1,
          updatedAt: 1,
        },
      },
      workspaceIndex: {
        'claude:c-set': 'w1',
      },
    };

    const sessionState: SessionState = {
      claimedTabs: {
        'w1:claude': {
          provider: 'claude',
          workspaceId: 'w1',
          tabId: 9,
          currentUrl: 'https://claude.ai/chat/c-set',
          sessionId: 'c-set',
          pageState: 'ready',
          lastSeenAt: 10,
        },
      },
    };

    storageMocks.getLocalState.mockResolvedValue(localState);
    storageMocks.getSessionState.mockResolvedValue(sessionState);

    const { handleUserSubmit } = await import('../entrypoints/background');
    const result = await handleUserSubmit(
      createSubmitMessage({
        currentUrl: 'https://claude.ai/chat/c-set?model=sonnet',
        sessionId: 'c-set',
        content: 'same session prompt',
      }),
      { tab: { id: 9 } } as chrome.runtime.MessageSender,
    );

    expect(storageMocks.clearClaimedTab).not.toHaveBeenCalled();
    expect(storageMocks.upsertClaimedTab).toHaveBeenCalledWith(
      'w1',
      'claude',
      expect.objectContaining({
        workspaceId: 'w1',
        provider: 'claude',
        tabId: 9,
        sessionId: 'c-set',
        currentUrl: 'https://claude.ai/chat/c-set?model=sonnet',
      }),
    );
    expect(storageMocks.setLocalState).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaces: expect.objectContaining({
          w1: expect.objectContaining({
            members: expect.objectContaining({
              claude: expect.objectContaining({
                sessionId: 'c-set',
                url: 'https://claude.ai/chat/c-set?model=sonnet',
              }),
            }),
          }),
        }),
      }),
    );
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        synced: true,
        workspaceId: 'w1',
      }),
    );
  });

  it('switches to the next claimed provider tab in workspace order', async () => {
    const localState: LocalState = {
      ...createLocalState(),
      workspaces: {
        w1: {
          id: 'w1',
          members: {
            claude: { provider: 'claude', sessionId: 'c-1', url: 'https://claude.ai/chat/c-1' },
            gemini: { provider: 'gemini', sessionId: 'm-1', url: 'https://gemini.google.com/app/m-1' },
            deepseek: { provider: 'deepseek', sessionId: 'd-1', url: 'https://chat.deepseek.com/a/chat/s/d-1' },
          },
          enabledProviders: ['claude', 'gemini', 'deepseek'],
          createdAt: 1,
          updatedAt: 1,
        },
      },
      workspaceIndex: {
        'claude:c-1': 'w1',
        'gemini:m-1': 'w1',
        'deepseek:d-1': 'w1',
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
        'w1:gemini': {
          provider: 'gemini',
          workspaceId: 'w1',
          tabId: 12,
          currentUrl: 'https://gemini.google.com/app/m-1',
          sessionId: 'm-1',
          pageState: 'login-required',
          lastSeenAt: 10,
        },
        'w1:deepseek': {
          provider: 'deepseek',
          workspaceId: 'w1',
          tabId: 13,
          currentUrl: 'https://chat.deepseek.com/a/chat/s/d-1',
          sessionId: 'd-1',
          pageState: 'not-ready',
          lastSeenAt: 10,
        },
      },
    };

    storageMocks.getLocalState.mockResolvedValue(localState);
    storageMocks.getSessionState.mockResolvedValue(sessionState);

    const { handleSwitchProviderTab } = await import('../entrypoints/background');
    const result = await handleSwitchProviderTab(
      { type: 'SWITCH_PROVIDER_TAB', provider: 'claude', direction: 'next' },
      { tab: { id: 9 } } as chrome.runtime.MessageSender,
    );

    expect(chrome.tabs.update).toHaveBeenCalledWith(12, { active: true });
    expect(result).toEqual({
      ok: true,
      switched: true,
      provider: 'gemini',
    });
  });

  it('switches to the previous claimed provider tab with wraparound', async () => {
    const localState: LocalState = {
      ...createLocalState(),
      workspaces: {
        w1: {
          id: 'w1',
          members: {
            claude: { provider: 'claude', sessionId: 'c-1', url: 'https://claude.ai/chat/c-1' },
            chatgpt: { provider: 'chatgpt', sessionId: 'g-1', url: 'https://chatgpt.com/c/g-1' },
            deepseek: { provider: 'deepseek', sessionId: 'd-1', url: 'https://chat.deepseek.com/a/chat/s/d-1' },
          },
          enabledProviders: ['claude', 'chatgpt', 'deepseek'],
          createdAt: 1,
          updatedAt: 1,
        },
      },
      workspaceIndex: {
        'claude:c-1': 'w1',
        'chatgpt:g-1': 'w1',
        'deepseek:d-1': 'w1',
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
        'w1:deepseek': {
          provider: 'deepseek',
          workspaceId: 'w1',
          tabId: 13,
          currentUrl: 'https://chat.deepseek.com/a/chat/s/d-1',
          sessionId: 'd-1',
          pageState: 'ready',
          lastSeenAt: 10,
        },
      },
    };

    storageMocks.getLocalState.mockResolvedValue(localState);
    storageMocks.getSessionState.mockResolvedValue(sessionState);

    const { handleSwitchProviderTab } = await import('../entrypoints/background');
    const result = await handleSwitchProviderTab(
      { type: 'SWITCH_PROVIDER_TAB', provider: 'claude', direction: 'previous' },
      { tab: { id: 9 } } as chrome.runtime.MessageSender,
    );

    expect(chrome.tabs.update).toHaveBeenCalledWith(13, { active: true });
    expect(result).toEqual({
      ok: true,
      switched: true,
      provider: 'deepseek',
    });
  });

  it('does not switch when the current tab has no other claimed provider tab in its set', async () => {
    const localState: LocalState = {
      ...createLocalState(),
      workspaces: {
        w1: {
          id: 'w1',
          members: {
            claude: { provider: 'claude', sessionId: 'c-1', url: 'https://claude.ai/chat/c-1' },
          },
          enabledProviders: ['claude', 'chatgpt'],
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
        'w1:claude': {
          provider: 'claude',
          workspaceId: 'w1',
          tabId: 9,
          currentUrl: 'https://claude.ai/chat/c-1',
          sessionId: 'c-1',
          pageState: 'ready',
          lastSeenAt: 10,
        },
      },
    };

    storageMocks.getLocalState.mockResolvedValue(localState);
    storageMocks.getSessionState.mockResolvedValue(sessionState);

    const { handleSwitchProviderTab } = await import('../entrypoints/background');
    const result = await handleSwitchProviderTab(
      { type: 'SWITCH_PROVIDER_TAB', provider: 'claude', direction: 'next' },
      { tab: { id: 9 } } as chrome.runtime.MessageSender,
    );

    expect(chrome.tabs.update).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      switched: false,
      reason: 'No other provider tab',
    });
  });

  it('sends sync progress updates back to the source tab during fan-out', async () => {
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

    storageMocks.getLocalState.mockResolvedValue(localState);
    storageMocks.getSessionState.mockResolvedValue(sessionState);

    const sendMessage = vi.fn().mockImplementation((tabId: number, message: { type: string }) => {
      if (message.type === 'PING') {
        return Promise.resolve({
          type: 'PING_RESPONSE',
          provider: 'chatgpt',
          currentUrl: 'https://chatgpt.com/c/g-1',
          sessionId: 'g-1',
          pageState: 'ready',
          pageKind: 'existing-session',
        });
      }

      if (message.type === 'DELIVER_PROMPT') {
        return Promise.resolve({ ok: true });
      }

      if (message.type === 'SYNC_PROGRESS') {
        return Promise.resolve({ ok: true });
      }

      return Promise.resolve({ ok: true, tabId });
    });

    vi.stubGlobal('chrome', {
      tabs: {
        get: vi.fn().mockResolvedValue({ id: 9 }),
        sendMessage,
        update: vi.fn().mockResolvedValue({ id: 10, windowId: 3 }),
        query: vi.fn().mockResolvedValue([]),
        onRemoved: { addListener: vi.fn() },
      },
      windows: {
        update: vi.fn().mockResolvedValue({ id: 3 }),
      },
    });

    const { handleUserSubmit } = await import('../entrypoints/background');
    await handleUserSubmit(
      createSubmitMessage({
        currentUrl: 'https://claude.ai/chat/c-1',
        sessionId: 'c-1',
        content: 'fan out',
      }),
      { tab: { id: 9 } } as chrome.runtime.MessageSender,
    );

    const syncProgressCalls = sendMessage.mock.calls.filter(
      ([tabId, message]) => tabId === 9 && message.type === 'SYNC_PROGRESS',
    );

    expect(syncProgressCalls).toEqual([
      [
        9,
        {
          type: 'SYNC_PROGRESS',
          workspaceId: 'w1',
          total: 1,
          completed: 0,
          succeeded: 0,
          failed: 0,
        },
      ],
      [
        9,
        {
          type: 'SYNC_PROGRESS',
          workspaceId: 'w1',
          total: 1,
          completed: 1,
          succeeded: 1,
          failed: 0,
        },
      ],
    ]);
  });
});
