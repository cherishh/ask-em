import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestStatus } from './popup-runtime';

describe('popup runtime', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns null when status messaging fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn().mockRejectedValue(new Error('runtime unavailable')),
      },
    });

    const result = await requestStatus();

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      'ask-em: failed to load popup status',
      expect.any(Error),
    );
  });
});
