import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SHORTCUTS, type ProviderStatus, type WorkspaceSummary } from '../runtime/protocol';
import type { UserSubmissionPayload } from '../adapters/types';

const routingMocks = vi.hoisted(() => ({
  buildHeartbeatMessage: vi.fn(() => ({ type: 'HEARTBEAT' })),
  buildHelloMessage: vi.fn(() => ({ type: 'HELLO' })),
  buildUserSubmitMessage: vi.fn(() => ({ type: 'USER_SUBMIT' })),
  createSubmitId: vi.fn(() => 'submit-test'),
  observeUrlChanges: vi.fn(() => vi.fn()),
  sendRuntimeMessage: vi.fn(),
}));

const uiMocks = vi.hoisted(() => ({
  createContentUi: vi.fn(),
}));

vi.mock('./routing', () => routingMocks);
vi.mock('./ui', async () => {
  const actual = await vi.importActual<typeof import('./ui')>('./ui');
  return {
    ...actual,
    createContentUi: uiMocks.createContentUi,
  };
});

function createWorkspaceSummary(
  memberStates: WorkspaceSummary['memberStates'] = {
    claude: 'ready',
    chatgpt: 'ready',
    gemini: 'ready',
  },
): WorkspaceSummary {
  return {
    workspace: {
      id: 'w1',
      members: {
        claude: { provider: 'claude', sessionId: 'c-1', url: 'https://claude.ai/chat/c-1' },
        chatgpt: { provider: 'chatgpt', sessionId: 'g-1', url: 'https://chatgpt.com/c/g-1' },
        gemini: { provider: 'gemini', sessionId: 'm-1', url: 'https://gemini.google.com/app/m-1' },
      },
      enabledProviders: ['claude', 'chatgpt', 'gemini'],
      createdAt: 1,
      updatedAt: 1,
    },
    memberStates,
    memberIssues: {
      claude: null,
      chatgpt: null,
      gemini: null,
    },
  };
}

function createHelloResponse(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: 'w1',
    providerEnabled: true,
    globalSyncEnabled: true,
    canStartNewSet: true,
    shortcuts: DEFAULT_SHORTCUTS,
    workspaceSummary: createWorkspaceSummary(),
    ...overrides,
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('content bootstrap wiring', () => {
  let runtimeListener:
    | ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => unknown)
    | null;
  let submitHandler: ((payload: UserSubmissionPayload) => void) | null;
  let beforeUnloadHandler: (() => void) | null;
  let status: ProviderStatus;
  let ui: {
    setContext: ReturnType<typeof vi.fn>;
    setVisible: ReturnType<typeof vi.fn>;
    setState: ReturnType<typeof vi.fn>;
    setSyncStatus: ReturnType<typeof vi.fn>;
    setAlertLevel: ReturnType<typeof vi.fn>;
    resetPosition: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    runtimeListener = null;
    submitHandler = null;
    beforeUnloadHandler = null;

    status = {
      provider: 'claude',
      currentUrl: 'https://claude.ai/chat/c-1',
      sessionId: 'c-1',
      pageKind: 'existing-session',
      pageState: 'ready',
    };

    ui = {
      setContext: vi.fn(),
      setVisible: vi.fn(),
      setState: vi.fn(),
      setSyncStatus: vi.fn(),
      setAlertLevel: vi.fn(),
      resetPosition: vi.fn(),
    };

    uiMocks.createContentUi.mockReturnValue(ui);
    routingMocks.sendRuntimeMessage.mockResolvedValue(createHelloResponse());

    vi.stubGlobal('window', {
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (event === 'beforeunload') {
          beforeUnloadHandler = handler;
        }
      }),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('document', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: {
          addListener: vi.fn((listener) => {
            runtimeListener = listener;
          }),
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function bootstrap() {
    const { bootstrapContentScript } = await import('./bootstrap');
    bootstrapContentScript({
      name: 'claude',
      getUiSpec() {
        return {
          mountId: 'ask-em-test-ui',
          className: 'ask-em-provider-ui ask-em-provider-ui-claude',
        };
      },
      session: {
        getStatus: () => status,
        getCurrentUrl: () => status.currentUrl,
        canDeliverPrompt: () => true,
      },
      composer: {
        subscribeToUserSubmissions(onSubmit) {
          submitHandler = onSubmit;
          return () => {
            submitHandler = null;
          };
        },
        setComposerText: vi.fn(),
        submit: vi.fn(),
      },
    });

    await flushMicrotasks();
  }

  it('maps HELLO workspace context into indicator UI', async () => {
    routingMocks.sendRuntimeMessage.mockResolvedValueOnce(
      createHelloResponse({
        workspaceSummary: createWorkspaceSummary({
          claude: 'ready',
          chatgpt: 'login-required',
          gemini: 'ready',
        }),
      }),
    );

    await bootstrap();

    expect(ui.setState).toHaveBeenLastCalledWith('idle', 'current model is in sync');
    expect(ui.setSyncStatus).toHaveBeenLastCalledWith('1 model needs attention', 'warning');
    expect(ui.setAlertLevel).toHaveBeenLastCalledWith('set-warning');
  });

  it('reports a final startup heartbeat when a new-chat page becomes ready', async () => {
    const intervalCallbacks: Array<() => void> = [];
    const setIntervalMock = window.setInterval as unknown as ReturnType<typeof vi.fn>;
    setIntervalMock.mockImplementation((handler: () => void) => {
      if (typeof handler === 'function') {
        intervalCallbacks.push(handler);
      }
      return intervalCallbacks.length;
    });
    status = {
      provider: 'claude',
      currentUrl: 'https://claude.ai/new',
      sessionId: null,
      pageKind: 'new-chat',
      pageState: 'not-ready',
    };
    const standaloneResponse = {
      workspaceId: null,
      providerEnabled: false,
      globalSyncEnabled: true,
      autoSyncNewChatsEnabled: true,
      nextFanOutTargetCount: 2,
      canStartNewSet: true,
      shortcuts: DEFAULT_SHORTCUTS,
      workspaceSummary: null,
    };
    routingMocks.sendRuntimeMessage.mockResolvedValue(standaloneResponse);

    await bootstrap();
    await flushMicrotasks();
    routingMocks.sendRuntimeMessage.mockClear();

    status = {
      ...status,
      pageState: 'ready',
    };
    intervalCallbacks[0]?.();
    await flushMicrotasks();

    expect(routingMocks.sendRuntimeMessage).toHaveBeenCalledWith({ type: 'HEARTBEAT' });
    expect(ui.setVisible).toHaveBeenLastCalledWith(true);
    expect(ui.setState).toHaveBeenLastCalledWith('idle', 'ready');
    expect(ui.setSyncStatus).toHaveBeenLastCalledWith('next prompt will fan out to 2 models', 'neutral');
  });

  it('updates indicator progress when SYNC_PROGRESS arrives for the current workspace', async () => {
    await bootstrap();

    const sendResponse = vi.fn();
    runtimeListener?.(
      {
        type: 'SYNC_PROGRESS',
        workspaceId: 'w1',
        total: 3,
        completed: 1,
        succeeded: 1,
        failed: 0,
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );
    await flushMicrotasks();

    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    expect(ui.setState).toHaveBeenLastCalledWith('syncing', 'current model is in sync');
    expect(ui.setSyncStatus).toHaveBeenLastCalledWith('1 of 3 synced', 'neutral');
    expect(ui.setAlertLevel).toHaveBeenLastCalledWith('normal');
  });

  it('resets indicator position when requested by the background', async () => {
    await bootstrap();

    const sendResponse = vi.fn();
    runtimeListener?.(
      {
        type: 'RESET_INDICATOR_POSITION',
      },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );
    await flushMicrotasks();

    expect(ui.resetPosition).toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });

  it('persists standalone fan-out toggle through the auto-sync setting', async () => {
    status = {
      provider: 'claude',
      currentUrl: 'https://claude.ai/new',
      sessionId: null,
      pageKind: 'new-chat',
      pageState: 'ready',
    };
    routingMocks.sendRuntimeMessage.mockResolvedValueOnce(
      createHelloResponse({
        workspaceId: null,
        providerEnabled: false,
        autoSyncNewChatsEnabled: true,
        nextFanOutTargetCount: 2,
        workspaceSummary: null,
      }),
    );

    await bootstrap();

    const handlers = uiMocks.createContentUi.mock.calls[0]?.[1] as
      | {
          onStandaloneSetCreationToggle(nextEnabled: boolean): Promise<void>;
        }
      | undefined;
    routingMocks.sendRuntimeMessage.mockClear();

    await handlers?.onStandaloneSetCreationToggle(false);

    expect(routingMocks.sendRuntimeMessage).toHaveBeenCalledWith({
      type: 'SET_AUTO_SYNC_NEW_CHATS_ENABLED',
      enabled: false,
    });
    expect(ui.setContext).toHaveBeenLastCalledWith(
      expect.objectContaining({
        standaloneCreateSetEnabled: false,
      }),
    );
    expect(ui.setState).toHaveBeenLastCalledWith('blocked', 'Local only');
    expect(ui.setSyncStatus).toHaveBeenLastCalledWith('next prompt stays here', 'neutral');
  });

  it('marks progress failures as set warnings', async () => {
    await bootstrap();

    runtimeListener?.(
      {
        type: 'SYNC_PROGRESS',
        workspaceId: 'w1',
        total: 3,
        completed: 2,
        succeeded: 1,
        failed: 1,
      },
      {} as chrome.runtime.MessageSender,
      vi.fn(),
    );
    await flushMicrotasks();

    expect(ui.setState).toHaveBeenLastCalledWith('syncing', 'current model is in sync');
    expect(ui.setSyncStatus).toHaveBeenLastCalledWith('1 of 3 synced', 'warning');
    expect(ui.setAlertLevel).toHaveBeenLastCalledWith('set-warning');
  });

  it('wires user submit through immediate syncing state and final workspace health', async () => {
    routingMocks.sendRuntimeMessage
      .mockResolvedValueOnce(createHelloResponse())
      .mockResolvedValueOnce(
        createHelloResponse({
          synced: true,
          workspaceSummary: createWorkspaceSummary(),
        }),
      );

    await bootstrap();

    submitHandler?.({ text: 'hello world', attachments: [] });
    await flushMicrotasks();

    expect(ui.setState).toHaveBeenCalledWith('syncing', 'current model is in sync');
    expect(ui.setSyncStatus).toHaveBeenCalledWith('syncing…', 'neutral');
    expect(ui.setState).toHaveBeenLastCalledWith('idle', 'current model is in sync');
    expect(ui.setSyncStatus).toHaveBeenLastCalledWith('all models synced', 'neutral');
    expect(ui.setAlertLevel).toHaveBeenLastCalledWith('normal');
  });

  it('does not report submit when the current page is not sync-eligible', async () => {
    status = {
      ...status,
      pageState: 'login-required',
      pageKind: 'new-chat',
      sessionId: null,
      currentUrl: 'https://claude.ai/login?returnTo=%2Fnew',
    };

    await bootstrap();
    routingMocks.sendRuntimeMessage.mockClear();

    submitHandler?.({ text: 'hello world', attachments: [] });
    await flushMicrotasks();

    expect(
      routingMocks.sendRuntimeMessage.mock.calls.some(
        ([message]) => message?.type === 'USER_SUBMIT',
      ),
    ).toBe(false);
    expect(ui.setState).toHaveBeenLastCalledWith('blocked', 'current model needs login');
    expect(ui.setSyncStatus).toHaveBeenLastCalledWith('sign in to sync', 'warning');
    expect(ui.setAlertLevel).toHaveBeenLastCalledWith('current-warning');
  });

  it('cleans up submit, url, timer, and event listeners on beforeunload', async () => {
    const unsubscribe = vi.fn();
    const stopObservingUrl = vi.fn();
    uiMocks.createContentUi.mockReturnValue(ui);
    routingMocks.observeUrlChanges.mockReturnValue(stopObservingUrl);

    const composer = {
      subscribeToUserSubmissions(onSubmit: (payload: UserSubmissionPayload) => void) {
        submitHandler = onSubmit;
        return unsubscribe;
      },
      setComposerText: vi.fn(),
      submit: vi.fn(),
    };

    const { bootstrapContentScript } = await import('./bootstrap');
    bootstrapContentScript({
      name: 'claude',
      getUiSpec() {
        return {
          mountId: 'ask-em-test-ui',
          className: 'ask-em-provider-ui ask-em-provider-ui-claude',
        };
      },
      session: {
        getStatus: () => status,
        getCurrentUrl: () => status.currentUrl,
        canDeliverPrompt: () => true,
      },
      composer,
    });

    await flushMicrotasks();
    beforeUnloadHandler?.();

    expect(unsubscribe).toHaveBeenCalled();
    expect(stopObservingUrl).toHaveBeenCalled();
    expect(window.clearInterval).toHaveBeenCalled();
    expect(window.removeEventListener).toHaveBeenCalledWith('focus', expect.any(Function));
    expect(document.removeEventListener).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    );
  });
});
