// @vitest-environment jsdom

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHookHarness } from './test-utils';
import { useProviderRequest } from './use-provider-request';

describe('useProviderRequest', () => {
  function stubLocalStorage() {
    const values = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        clear: vi.fn(() => values.clear()),
        getItem: vi.fn((key: string) => values.get(key) ?? null),
        removeItem: vi.fn((key: string) => {
          values.delete(key);
        }),
        setItem: vi.fn((key: string, value: string) => {
          values.set(key, value);
        }),
      },
    });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    stubLocalStorage();
    window.localStorage.clear();
    globalThis.fetch = vi.fn(async () => ({ ok: true } as Response)) as unknown as typeof fetch;
    globalThis.chrome = {
      runtime: {
        getManifest: () => ({ version: '0.1.0' }),
      },
    } as unknown as typeof chrome;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('surfaces endpoint-not-configured when no request endpoint is available', async () => {
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
    expect(hook.current.requestEndpointNotConfigured).toBe(true);
    expect(hook.current.requestCooldownUntil).toBeNull();
    expect(window.localStorage.getItem('askem-more-providers-last-submitted-at')).toBeNull();

    errorSpy.mockRestore();
    hook.unmount();
  });

  it('submits a custom provider request from the Other input', async () => {
    vi.stubEnv('WXT_MORE_PROVIDERS_REQUEST_ENDPOINT', 'https://support.example.com/requests/providers');
    const hook = renderHookHarness(() => useProviderRequest());

    await act(async () => {
      hook.current.openRequestModal();
      hook.current.setOtherProviderText('  You.com   AI  ');
    });
    await act(async () => {
      await hook.current.submitRequestModal();
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      requestedProviders: ['You.com AI'],
      extensionVersion: '0.1.0',
    });
    expect(hook.current.requestSubmitted).toBe(true);

    hook.unmount();
  });

  it('deduplicates preset and custom provider requests before submitting', async () => {
    vi.stubEnv('WXT_MORE_PROVIDERS_REQUEST_ENDPOINT', 'https://support.example.com/requests/providers');
    const hook = renderHookHarness(() => useProviderRequest());

    await act(async () => {
      hook.current.openRequestModal();
      hook.current.toggleRequestedProvider('Perplexity');
      hook.current.setOtherProviderText('Perplexity');
    });
    await act(async () => {
      await hook.current.submitRequestModal();
    });

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      requestedProviders: ['Perplexity'],
    });

    hook.unmount();
  });
});
