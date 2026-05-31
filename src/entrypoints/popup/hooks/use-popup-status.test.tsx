// @vitest-environment jsdom

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHookHarness, flushMicrotasks } from './test-utils';

const popupRuntimeMocks = vi.hoisted(() => ({
  requestStatus: vi.fn(),
}));

vi.mock('../popup-runtime', () => popupRuntimeMocks);

import { usePopupStatus } from './use-popup-status';

describe('usePopupStatus', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    popupRuntimeMocks.requestStatus.mockReset();
    popupRuntimeMocks.requestStatus.mockResolvedValue(null);
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('clears loading when status refresh returns no data', async () => {
    popupRuntimeMocks.requestStatus.mockResolvedValueOnce(null);

    const hook = renderHookHarness(() => usePopupStatus());
    await flushMicrotasks();

    expect(hook.current.loading).toBe(false);
    hook.unmount();
  });

  it('clears busyKey when clearing a workspace fails', async () => {
    popupRuntimeMocks.requestStatus.mockResolvedValue({
      workspaces: [],
      globalSyncEnabled: true,
      autoSyncNewChatsEnabled: true,
      defaultEnabledProviders: {
        claude: true,
        chatgpt: true,
        gemini: true,
        deepseek: true,
        manus: true,
      },
      shortcuts: undefined,
      debugLoggingEnabled: false,
      showDiagnostics: false,
      closeTabsOnDeleteSet: false,
      workspaceLimit: 3,
      recentLogs: [],
      type: 'STATUS_RESPONSE',
    });

    const sendMessage = vi.fn().mockRejectedValue(new Error('fail'));
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage,
      },
    });

    const hook = renderHookHarness(() => usePopupStatus());
    await flushMicrotasks();

    await expect(
      act(async () => {
        await hook.current.clearWorkspace('w1');
      }),
    ).rejects.toThrow('fail');

    expect(hook.current.busyKey).toBeNull();
    hook.unmount();
  });

  it('clears persistent storage through the runtime and refreshes status', async () => {
    popupRuntimeMocks.requestStatus
      .mockResolvedValueOnce({
        workspaces: [],
        globalSyncEnabled: true,
        autoSyncNewChatsEnabled: true,
        defaultEnabledProviders: {
          claude: true,
          chatgpt: true,
          gemini: true,
          deepseek: true,
          manus: true,
        },
        shortcuts: undefined,
        debugLoggingEnabled: false,
        showDiagnostics: false,
        closeTabsOnDeleteSet: false,
        workspaceLimit: 3,
        recentLogs: [],
        type: 'STATUS_RESPONSE',
      })
      .mockResolvedValueOnce({
        workspaces: [],
        globalSyncEnabled: true,
        autoSyncNewChatsEnabled: true,
        defaultEnabledProviders: {
          claude: true,
          chatgpt: true,
          gemini: true,
          deepseek: true,
          manus: true,
        },
        shortcuts: undefined,
        debugLoggingEnabled: false,
        showDiagnostics: false,
        closeTabsOnDeleteSet: false,
        workspaceLimit: 3,
        recentLogs: [],
        type: 'STATUS_RESPONSE',
      });

    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage,
      },
    });

    const hook = renderHookHarness(() => usePopupStatus());
    await flushMicrotasks();

    await act(async () => {
      await hook.current.clearPersistentStorage();
    });

    expect(sendMessage).toHaveBeenCalledWith({ type: 'CLEAR_PERSISTENT_STORAGE' });
    expect(popupRuntimeMocks.requestStatus).toHaveBeenCalledTimes(2);
    hook.unmount();
  });

  it('skips polling while the popup document is hidden', async () => {
    popupRuntimeMocks.requestStatus.mockResolvedValue(null);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });

    const hook = renderHookHarness(() => usePopupStatus());
    await flushMicrotasks();
    expect(popupRuntimeMocks.requestStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(3_000);
      await flushMicrotasks();
    });

    expect(popupRuntimeMocks.requestStatus).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  it('refreshes when the popup becomes visible again', async () => {
    popupRuntimeMocks.requestStatus.mockResolvedValue(null);
    let visibilityState: DocumentVisibilityState = 'hidden';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    });

    const hook = renderHookHarness(() => usePopupStatus());
    await flushMicrotasks();
    expect(popupRuntimeMocks.requestStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      visibilityState = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      await flushMicrotasks();
    });

    expect(popupRuntimeMocks.requestStatus).toHaveBeenCalledTimes(2);
    hook.unmount();
  });

  it('toggles diagnostics visibility through the runtime and refreshes status', async () => {
    popupRuntimeMocks.requestStatus
      .mockResolvedValueOnce({
        type: 'STATUS_RESPONSE',
        workspaces: [],
        globalSyncEnabled: true,
        autoSyncNewChatsEnabled: true,
        defaultEnabledProviders: {
          claude: true,
          chatgpt: true,
          gemini: true,
          deepseek: true,
          manus: true,
        },
        shortcuts: undefined,
        debugLoggingEnabled: true,
        showDiagnostics: false,
        closeTabsOnDeleteSet: false,
        workspaceLimit: 3,
        recentLogs: [],
      })
      .mockResolvedValueOnce({
        type: 'STATUS_RESPONSE',
        workspaces: [],
        globalSyncEnabled: true,
        autoSyncNewChatsEnabled: true,
        defaultEnabledProviders: {
          claude: true,
          chatgpt: true,
          gemini: true,
          deepseek: true,
          manus: true,
        },
        shortcuts: undefined,
        debugLoggingEnabled: true,
        showDiagnostics: true,
        closeTabsOnDeleteSet: false,
        workspaceLimit: 3,
        recentLogs: [],
      });

    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage,
      },
    });

    const hook = renderHookHarness(() => usePopupStatus());
    await flushMicrotasks();

    await act(async () => {
      await hook.current.toggleShowDiagnostics();
    });

    expect(sendMessage).toHaveBeenCalledWith({ type: 'SET_SHOW_DIAGNOSTICS', enabled: true });
    expect(popupRuntimeMocks.requestStatus).toHaveBeenCalledTimes(2);
    hook.unmount();
  });

  it('toggles default fan-out providers without changing default providers', async () => {
    const initialStatus = {
      type: 'STATUS_RESPONSE',
      workspaces: [],
      globalSyncEnabled: true,
      autoSyncNewChatsEnabled: true,
      defaultEnabledProviders: {
        claude: true,
        chatgpt: true,
        gemini: false,
        deepseek: false,
        manus: false,
      },
      defaultFanOutProviders: null,
      shortcuts: undefined,
      debugLoggingEnabled: true,
      showDiagnostics: false,
      closeTabsOnDeleteSet: false,
      workspaceLimit: 3,
      recentLogs: [],
    };

    popupRuntimeMocks.requestStatus
      .mockResolvedValueOnce(initialStatus)
      .mockResolvedValueOnce({
        ...initialStatus,
        defaultFanOutProviders: ['claude'],
      });

    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage,
      },
    });

    const hook = renderHookHarness(() => usePopupStatus());
    await flushMicrotasks();

    expect(hook.current.enabledProviders).toEqual(['claude', 'chatgpt']);
    expect(hook.current.defaultFanOutSelectedProviders).toEqual(['claude', 'chatgpt']);

    await act(async () => {
      await hook.current.toggleDefaultFanOutProvider('chatgpt');
    });

    expect(hook.current.enabledProviders).toEqual(['claude', 'chatgpt']);
    expect(hook.current.defaultFanOutSelectedProviders).toEqual(['claude']);
    expect(sendMessage).toHaveBeenCalledWith(
      { type: 'SET_DEFAULT_FAN_OUT_PROVIDERS', providers: ['claude'] },
    );
    hook.unmount();
  });

  it('does not turn off the last default fan-out provider', async () => {
    const initialStatus = {
      type: 'STATUS_RESPONSE',
      workspaces: [],
      globalSyncEnabled: true,
      autoSyncNewChatsEnabled: true,
      defaultEnabledProviders: {
        claude: true,
        chatgpt: true,
        gemini: false,
        deepseek: false,
        manus: false,
      },
      defaultFanOutProviders: ['claude'],
      shortcuts: undefined,
      debugLoggingEnabled: true,
      showDiagnostics: false,
      closeTabsOnDeleteSet: false,
      workspaceLimit: 3,
      recentLogs: [],
    };
    popupRuntimeMocks.requestStatus.mockResolvedValue(initialStatus);

    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage,
      },
    });

    const hook = renderHookHarness(() => usePopupStatus());
    await flushMicrotasks();

    await act(async () => {
      await hook.current.toggleDefaultFanOutProvider('claude');
    });

    expect(hook.current.defaultFanOutSelectedProviders).toEqual(['claude']);
    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_DEFAULT_FAN_OUT_PROVIDERS' }),
    );
    hook.unmount();
  });

  it('keeps default fan-out selection when changing enabled providers', async () => {
    const initialStatus = {
      type: 'STATUS_RESPONSE',
      workspaces: [],
      globalSyncEnabled: true,
      autoSyncNewChatsEnabled: true,
      defaultEnabledProviders: {
        claude: true,
        chatgpt: true,
        gemini: true,
        deepseek: false,
        manus: false,
      },
      defaultFanOutProviders: ['claude', 'chatgpt'],
      shortcuts: undefined,
      debugLoggingEnabled: true,
      showDiagnostics: false,
      closeTabsOnDeleteSet: false,
      workspaceLimit: 3,
      recentLogs: [],
    };
    popupRuntimeMocks.requestStatus
      .mockResolvedValueOnce(initialStatus)
      .mockResolvedValueOnce({
        ...initialStatus,
        defaultEnabledProviders: {
          ...initialStatus.defaultEnabledProviders,
          gemini: false,
        },
      });

    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage,
      },
    });

    const hook = renderHookHarness(() => usePopupStatus());
    await flushMicrotasks();

    await act(async () => {
      await hook.current.toggleEnabledProvider('gemini');
      await flushMicrotasks();
    });

    expect(hook.current.enabledProviders).toEqual(['claude', 'chatgpt']);
    expect(hook.current.defaultFanOutSelectedProviders).toEqual(['claude', 'chatgpt']);
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'SET_DEFAULT_ENABLED_PROVIDERS',
      providers: ['claude', 'chatgpt'],
    });
    hook.unmount();
  });

  it('selects a newly enabled provider for default fan-out', async () => {
    const initialStatus = {
      type: 'STATUS_RESPONSE',
      workspaces: [],
      globalSyncEnabled: true,
      autoSyncNewChatsEnabled: true,
      defaultEnabledProviders: {
        claude: true,
        chatgpt: true,
        gemini: false,
        deepseek: false,
        manus: false,
      },
      defaultFanOutProviders: ['claude'],
      shortcuts: undefined,
      debugLoggingEnabled: true,
      showDiagnostics: false,
      closeTabsOnDeleteSet: false,
      workspaceLimit: 3,
      recentLogs: [],
    };
    popupRuntimeMocks.requestStatus
      .mockResolvedValueOnce(initialStatus)
      .mockResolvedValueOnce({
        ...initialStatus,
        defaultEnabledProviders: {
          ...initialStatus.defaultEnabledProviders,
          gemini: true,
        },
        defaultFanOutProviders: ['claude', 'gemini'],
      });

    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage,
      },
    });

    const hook = renderHookHarness(() => usePopupStatus());
    await flushMicrotasks();

    await act(async () => {
      await hook.current.toggleEnabledProvider('gemini');
      await flushMicrotasks();
    });

    expect(hook.current.enabledProviders).toEqual(['claude', 'chatgpt', 'gemini']);
    expect(hook.current.defaultFanOutSelectedProviders).toEqual(['claude', 'gemini']);
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'SET_DEFAULT_ENABLED_PROVIDERS',
      providers: ['claude', 'chatgpt', 'gemini'],
    });
    hook.unmount();
  });

  it('toggles pause after first fan-out through the runtime', async () => {
    const initialStatus = {
      type: 'STATUS_RESPONSE',
      workspaces: [],
      globalSyncEnabled: true,
      autoSyncNewChatsEnabled: true,
      pauseAfterFirstFanOutEnabled: true,
      defaultEnabledProviders: {
        claude: true,
        chatgpt: true,
        gemini: true,
        deepseek: false,
        manus: false,
      },
      defaultFanOutProviders: null,
      shortcuts: undefined,
      debugLoggingEnabled: true,
      showDiagnostics: false,
      closeTabsOnDeleteSet: false,
      workspaceLimit: 3,
      recentLogs: [],
    };
    popupRuntimeMocks.requestStatus.mockResolvedValue(initialStatus);

    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage,
      },
    });

    const hook = renderHookHarness(() => usePopupStatus());
    await flushMicrotasks();

    await act(async () => {
      await hook.current.togglePauseAfterFirstFanOut();
    });

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'SET_PAUSE_AFTER_FIRST_FAN_OUT_ENABLED',
      enabled: false,
    });
    hook.unmount();
  });
});
