// @vitest-environment jsdom

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHookHarness } from './test-utils';
import { useProviderRequest } from './use-provider-request';

describe('useProviderRequest', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not mark the request as submitted when no endpoint is configured', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const hook = renderHookHarness(() => useProviderRequest());

    await act(async () => {
      hook.current.openRequestModal();
    });
    await act(async () => {
      hook.current.toggleRequestedProvider('Perplexity');
    });
    await act(async () => {
      await hook.current.submitRequestModal();
    });

    expect(hook.current.requestSubmitted).toBe(false);
    expect(hook.current.requestComingSoon).toBe(true);
    expect(hook.current.requestCooldownUntil).toBeNull();
    expect(window.localStorage.getItem('askem-more-providers-last-submitted-at')).toBeNull();

    errorSpy.mockRestore();
    hook.unmount();
  });
});
