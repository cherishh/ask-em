import { describe, expect, it } from 'vitest';
import { isClaudeLoginRequiredPage } from './claude';
import { isDeepseekLoginRequiredPage } from './deepseek';
import { isGeminiLoginRequiredPage } from './gemini';

describe('provider login-required detection', () => {
  it('treats Gemini /app with visible sign-in CTA as login-required', () => {
    expect(
      isGeminiLoginRequiredPage({
        pathname: '/app',
        buttonTexts: ['Sign in', 'Write', 'Plan'],
      }),
    ).toBe(true);
  });

  it('treats DeepSeek sign-in form as login-required', () => {
    expect(
      isDeepseekLoginRequiredPage({
        pathname: '/sign_in',
        buttonTexts: ['Sign up', 'Log in'],
        inputs: [
          { type: 'text', placeholder: 'Phone number / email address', ariaLabel: null },
          { type: 'password', placeholder: 'Password', ariaLabel: null },
        ],
      }),
    ).toBe(true);
  });

  it('treats Claude login CTA cluster as login-required', () => {
    expect(
      isClaudeLoginRequiredPage({
        pathname: '/login',
        buttonTexts: ['Continue with Google', 'Continue with email', 'Console login'],
      }),
    ).toBe(true);
  });
});
