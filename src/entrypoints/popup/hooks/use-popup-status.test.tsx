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
      defaultEnabledProviders: {
        claude: true,
        chatgpt: true,
        gemini: true,
        deepseek: true,
        manus: true,
      },
      canStartNewSet: true,
      shortcuts: undefined,
      debugLoggingEnabled: false,
      closeTabsOnDeleteSet: false,
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
        defaultEnabledProviders: {
          claude: true,
          chatgpt: true,
          gemini: true,
          deepseek: true,
          manus: true,
        },
        shortcuts: undefined,
        debugLoggingEnabled: false,
        closeTabsOnDeleteSet: false,
      })
      .mockResolvedValueOnce({
        workspaces: [],
        globalSyncEnabled: true,
        defaultEnabledProviders: {
          claude: true,
          chatgpt: true,
          gemini: true,
          deepseek: true,
          manus: true,
        },
        shortcuts: undefined,
        debugLoggingEnabled: false,
        closeTabsOnDeleteSet: false,
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
});
