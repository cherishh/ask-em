import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendRuntimeMessage } from './routing';

describe('content routing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null and invokes onError when runtime messaging throws', async () => {
    const onError = vi.fn();

    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn().mockRejectedValue(new Error('runtime unavailable')),
      },
    });

    const result = await sendRuntimeMessage({ type: 'PING' }, { onError });

    expect(result).toBeNull();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });
});
