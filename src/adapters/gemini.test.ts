import { afterEach, describe, expect, it, vi } from 'vitest';
import { geminiAdapter } from './gemini';
import { expectDeliverySessionGuard, stubAdapterPage } from './test-utils';

describe('gemini adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects a ready existing session', () => {
    stubAdapterPage({
      url: 'https://gemini.google.com/app/gemini-session-1',
      visibleSelectors: ['.ql-editor[role="textbox"]'],
    });

    expect(geminiAdapter.getStatus()).toMatchObject({
      provider: 'gemini',
      sessionId: 'gemini-session-1',
      pageKind: 'existing-session',
      pageState: 'ready',
    });
  });

  it('detects login-required on the app page without a composer', () => {
    stubAdapterPage({
      url: 'https://gemini.google.com/app',
      bodyText: 'Sign in with your Google account',
    });

    expect(geminiAdapter.getStatus()).toMatchObject({
      sessionId: null,
      pageKind: 'new-chat',
      pageState: 'login-required',
    });
  });

  it('does not report ready on an error page with a mounted composer', () => {
    stubAdapterPage({
      url: 'https://gemini.google.com/app/missing-session',
      bodyText: 'Something went wrong. Try again in a bit.',
      visibleSelectors: ['.ql-editor[role="textbox"]'],
    });

    expect(geminiAdapter.getStatus()).toMatchObject({
      sessionId: 'missing-session',
      pageKind: 'existing-session',
      pageState: 'not-ready',
    });
  });

  it('guards delivery by provider, page state, and expected session', () => {
    expectDeliverySessionGuard(geminiAdapter, 'gemini', 'gemini-session-1');
  });
});
