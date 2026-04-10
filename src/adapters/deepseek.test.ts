import { afterEach, describe, expect, it, vi } from 'vitest';
import { deepseekAdapter } from './deepseek';
import { expectDeliverySessionGuard, stubAdapterPage } from './test-utils';

describe('deepseek adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects a ready existing session', () => {
    stubAdapterPage({
      url: 'https://chat.deepseek.com/a/chat/s/deepseek-session-1',
      visibleSelectors: ['textarea[placeholder="Message DeepSeek"]'],
    });

    expect(deepseekAdapter.getStatus()).toMatchObject({
      provider: 'deepseek',
      sessionId: 'deepseek-session-1',
      pageKind: 'existing-session',
      pageState: 'ready',
    });
  });

  it('detects login-required on a new chat page without a composer', () => {
    stubAdapterPage({
      url: 'https://chat.deepseek.com/new',
      bodyText: 'Log in with your phone number',
    });

    expect(deepseekAdapter.getStatus()).toMatchObject({
      sessionId: null,
      pageKind: 'new-chat',
      pageState: 'login-required',
    });
  });

  it('does not report ready on an error page with a mounted composer', () => {
    stubAdapterPage({
      url: 'https://chat.deepseek.com/a/chat/s/missing-session',
      bodyText: 'Network error. Something went wrong.',
      visibleSelectors: ['textarea[placeholder="Message DeepSeek"]'],
    });

    expect(deepseekAdapter.getStatus()).toMatchObject({
      sessionId: 'missing-session',
      pageKind: 'existing-session',
      pageState: 'not-ready',
    });
  });

  it('guards delivery by provider, page state, and expected session', () => {
    expectDeliverySessionGuard(deepseekAdapter, 'deepseek', 'deepseek-session-1');
  });
});
