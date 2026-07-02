import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureSupportEndpointPermission } from './support-permissions';

describe('ensureSupportEndpointPermission', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('requests the endpoint origin directly', async () => {
    const request = vi.fn(async () => true);
    vi.stubGlobal('chrome', {
      permissions: {
        request,
      },
    });

    await expect(
      ensureSupportEndpointPermission('https://support.example.com/support/feedback'),
    ).resolves.toBe(true);

    expect(request).toHaveBeenCalledWith({
      origins: ['https://support.example.com/*'],
    });
  });

  it('returns false when the user declines endpoint access', async () => {
    const request = vi.fn(async () => false);
    vi.stubGlobal('chrome', {
      permissions: {
        request,
      },
    });

    await expect(
      ensureSupportEndpointPermission('https://support.example.com/requests/providers'),
    ).resolves.toBe(false);

    expect(request).toHaveBeenCalledWith({
      origins: ['https://support.example.com/*'],
    });
  });

  it('treats invalid or non-extension runtimes as already allowed', async () => {
    vi.stubGlobal('chrome', undefined);

    await expect(ensureSupportEndpointPermission('not a url')).resolves.toBe(true);
  });
});
