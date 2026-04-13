import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SHORTCUTS, type ProviderStatus, type WorkspaceSummary } from '../runtime/protocol';

const routingMocks = vi.hoisted(() => ({
  buildHeartbeatMessage: vi.fn(() => ({ type: 'HEARTBEAT' })),
  buildHelloMessage: vi.fn(() => ({ type: 'HELLO' })),
  buildUserSubmitMessage: vi.fn(() => ({ type: 'USER_SUBMIT' })),
  observeUrlChanges: vi.fn(() => vi.fn()),
  sendRuntimeMessage: vi.fn(),
}));

const uiMocks = vi.hoisted(() => ({
  createContentUi: vi.fn(),
}));

vi.mock('./content-routing', () => routingMocks);
vi.mock('./content-ui', async () => {
  const actual = await vi.importActual<typeof import('./content-ui')>('./content-ui');
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
}

describe('content bootstrap wiring', () => {
  let runtimeListener:
    | ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => unknown)
    | null;
  let submitHandler: ((content: string) => void) | null;
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
    const { bootstrapContentScript } = await import('./content-bootstrap');
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

    submitHandler?.('hello world');
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

    submitHandler?.('hello world');
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
      subscribeToUserSubmissions(onSubmit: (content: string) => void) {
        submitHandler = onSubmit;
        return unsubscribe;
      },
      setComposerText: vi.fn(),
      submit: vi.fn(),
    };

    const { bootstrapContentScript } = await import('./content-bootstrap');
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
