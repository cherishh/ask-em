import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatgptAdapter } from './chatgpt';
import { expectDeliverySessionGuard, stubAdapterPage } from './test-utils';

describe('chatgpt adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects a ready existing session', () => {
    stubAdapterPage({
      url: 'https://chatgpt.com/c/gpt-session-1',
      visibleSelectors: ['#prompt-textarea'],
    });

    expect(chatgptAdapter.getStatus()).toMatchObject({
      provider: 'chatgpt',
      sessionId: 'gpt-session-1',
      pageKind: 'existing-session',
      pageState: 'ready',
    });
  });

  it('detects login-required on a blank chat page without a composer', () => {
    stubAdapterPage({
      url: 'https://chatgpt.com/',
      bodyText: 'Log in or sign up to continue with Google',
    });

    expect(chatgptAdapter.getStatus()).toMatchObject({
      sessionId: null,
      pageKind: 'new-chat',
      pageState: 'login-required',
    });
  });

  it('does not report ready on an error page with a mounted composer', () => {
    stubAdapterPage({
      url: 'https://chatgpt.com/c/missing-session',
      bodyText: 'Unable to load conversation',
      visibleSelectors: ['#prompt-textarea'],
    });

    expect(chatgptAdapter.getStatus()).toMatchObject({
      sessionId: 'missing-session',
      pageKind: 'existing-session',
      pageState: 'not-ready',
    });
  });

  it('guards delivery by provider, page state, and expected session', () => {
    expectDeliverySessionGuard(chatgptAdapter, 'chatgpt', 'gpt-session-1');
  });
});
