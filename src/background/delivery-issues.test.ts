import { describe, expect, it } from 'vitest';
import { classifyDeliveryIssue } from './delivery-issues';

describe('classifyDeliveryIssue', () => {
  it('maps login-required failures to needs-login', () => {
    expect(
      classifyDeliveryIssue({
        provider: 'chatgpt',
        ok: false,
        reason: 'chatgpt login required',
      }),
    ).toBe('needs-login');
  });

  it('maps explicit error pages to error-page', () => {
    expect(
      classifyDeliveryIssue({
        provider: 'claude',
        ok: false,
        reason: 'claude error page',
      }),
    ).toBe('error-page');
  });

  it('keeps not-ready and blocked failures as loading', () => {
    expect(
      classifyDeliveryIssue({
        provider: 'gemini',
        ok: false,
        reason: 'gemini not ready',
      }),
    ).toBe('loading');

    expect(
      classifyDeliveryIssue({
        provider: 'gemini',
        ok: false,
        reason: 'Prompt delivery blocked',
      }),
    ).toBe('loading');
  });
});
