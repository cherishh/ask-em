import { afterEach, describe, expect, it, vi } from 'vitest';
import { claudeAdapter } from './claude';
import { expectDeliverySessionGuard, stubAdapterPage } from './test-utils';

describe('claude adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects a ready existing session', () => {
    stubAdapterPage({
      url: 'https://claude.ai/chat/claude-session-1',
      visibleSelectors: ['[data-testid="chat-input"]'],
    });

    expect(claudeAdapter.getStatus()).toMatchObject({
      provider: 'claude',
      sessionId: 'claude-session-1',
      pageKind: 'existing-session',
      pageState: 'ready',
    });
  });

  it('detects login-required on a new chat page without a composer', () => {
    stubAdapterPage({
      url: 'https://claude.ai/new',
      bodyText: 'Sign in to continue with Google',
    });

    expect(claudeAdapter.getStatus()).toMatchObject({
      sessionId: null,
      pageKind: 'new-chat',
      pageState: 'login-required',
    });
  });

  it('does not report ready on an error page with a mounted composer', () => {
    stubAdapterPage({
      url: 'https://claude.ai/chat/missing-session',
      bodyText: 'Conversation not found',
      visibleSelectors: ['[data-testid="chat-input"]'],
    });

    expect(claudeAdapter.getStatus()).toMatchObject({
      sessionId: 'missing-session',
      pageKind: 'existing-session',
      pageState: 'not-ready',
    });
  });

  it('guards delivery by provider, page state, and expected session', () => {
    expectDeliverySessionGuard(claudeAdapter, 'claude', 'claude-session-1');
  });
});
