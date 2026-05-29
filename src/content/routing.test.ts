import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildUserSubmitMessage, sendRuntimeMessage } from './routing';
import type { ProviderStatus } from '../runtime/protocol';

describe('content routing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds text-only submit messages with empty attachment defaults', () => {
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => 'submit-1'),
    });

    const status: ProviderStatus = {
      provider: 'claude',
      currentUrl: 'https://claude.ai/chat/c-1',
      sessionId: 'c-1',
      pageKind: 'existing-session',
      pageState: 'ready',
    };

    expect(buildUserSubmitMessage(status, 'hello', true)).toMatchObject({
      type: 'USER_SUBMIT',
      provider: 'claude',
      currentUrl: 'https://claude.ai/chat/c-1',
      sessionId: 'c-1',
      pageKind: 'existing-session',
      allowNewSetCreation: true,
      content: 'hello',
      attachments: [],
      submitId: 'submit-1',
    });
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
