// @vitest-environment jsdom

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHookHarness } from './test-utils';

const popupRuntimeMocks = vi.hoisted(() => ({
  downloadJsonFile: vi.fn(),
  requestFullLogs: vi.fn(),
}));

vi.mock('../popup-runtime', () => popupRuntimeMocks);

import { useDiagnostics } from './use-diagnostics';

describe('useDiagnostics', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    popupRuntimeMocks.requestFullLogs.mockReset();
    popupRuntimeMocks.downloadJsonFile.mockReset();
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clears the busy flag when clearing logs fails', async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn().mockRejectedValue(new Error('fail')),
      },
    });

    const hook = renderHookHarness(() => useDiagnostics(false, vi.fn().mockResolvedValue(undefined)));

    await expect(
      act(async () => {
        await hook.current.clearLogs();
      }),
    ).rejects.toThrow('fail');

    expect(hook.current.logActionBusy).toBe(false);
    hook.unmount();
  });
});
