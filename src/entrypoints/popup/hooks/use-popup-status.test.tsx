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
});
