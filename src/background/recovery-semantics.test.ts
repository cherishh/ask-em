import { describe, expect, it } from 'vitest';
import { getRecoveryStatusError, isTerminalRecoveryPageState } from './recovery-semantics';

describe('recovery-semantics', () => {
  it('treats ready, login-required, and error as terminal recovery states', () => {
    expect(isTerminalRecoveryPageState('ready')).toBe(true);
    expect(isTerminalRecoveryPageState('login-required')).toBe(true);
    expect(isTerminalRecoveryPageState('error')).toBe(true);
    expect(isTerminalRecoveryPageState('not-ready')).toBe(false);
  });

  it('maps recovery statuses to explicit delivery errors', () => {
    expect(getRecoveryStatusError('claude', null)).toBe('claude not ready');
    expect(
      getRecoveryStatusError('claude', {
        type: 'PING_RESPONSE',
        provider: 'claude',
        currentUrl: 'https://claude.ai',
        sessionId: null,
        pageState: 'login-required',
        pageKind: 'new-chat',
      }),
    ).toBe('claude login required');
    expect(
      getRecoveryStatusError('claude', {
        type: 'PING_RESPONSE',
        provider: 'claude',
        currentUrl: 'https://claude.ai/chat/missing',
        sessionId: null,
        pageState: 'error',
        pageKind: 'existing-session',
      }),
    ).toBe('claude error page');
    expect(
      getRecoveryStatusError('claude', {
        type: 'PING_RESPONSE',
        provider: 'claude',
        currentUrl: 'https://claude.ai/new',
        sessionId: null,
        pageState: 'not-ready',
        pageKind: 'new-chat',
      }),
    ).toBe('claude not ready');
  });
});
