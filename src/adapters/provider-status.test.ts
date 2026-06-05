// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { isClaudeLoginRequiredPage, isClaudePrivateModePage } from './claude';
import { isChatgptLoginRequiredPage, isChatgptPrivateModePage } from './chatgpt';
import { isDeepseekLoginRequiredPage } from './deepseek';
import { isGeminiLoginRequiredPage, isGeminiPrivateModePage } from './gemini';
import { isManusLoginRequiredPage } from './manus';

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

  it('treats the ChatGPT welcome-back chooser as login-required', () => {
    expect(
      isChatgptLoginRequiredPage({
        pathname: '/',
        headingTexts: ['Welcome back'],
        buttonTexts: ['Log in', 'Sign up for free'],
      }),
    ).toBe(true);
  });

  it('treats the Manus landing page with auth CTAs as login-required', () => {
    expect(
      isManusLoginRequiredPage({
        pathname: '/',
        buttonTexts: ['Sign in', 'Sign up', 'Create slides'],
      }),
    ).toBe(true);
  });

  it('does not treat a normal ChatGPT chat surface as login-required without auth CTAs', () => {
    expect(
      isChatgptLoginRequiredPage({
        pathname: '/c/abc123',
        headingTexts: ['ChatGPT'],
        buttonTexts: ['New chat', 'Search chats'],
      }),
    ).toBe(false);
  });

  it('does not treat Manus logged-in app chrome as login-required without auth CTAs', () => {
    expect(
      isManusLoginRequiredPage({
        pathname: '/app/abc123',
        buttonTexts: ['Create slides', 'Build website', 'Design'],
      }),
    ).toBe(false);
  });
});

describe('provider private-mode detection', () => {
  it('detects Claude incognito from the URL query', () => {
    expect(isClaudePrivateModePage('https://claude.ai/new?incognito=')).toBe(true);
    expect(isClaudePrivateModePage('https://claude.ai/new')).toBe(false);
  });

  it('detects ChatGPT temporary chat from the URL query', () => {
    expect(isChatgptPrivateModePage('https://chatgpt.com/?temporary-chat=true')).toBe(true);
    expect(isChatgptPrivateModePage('https://chatgpt.com/?temporary-chat=false')).toBe(false);
  });

  it('detects Gemini temporary chat from structural state', () => {
    document.body.innerHTML = '<chat-window class="is-temporary-chat"></chat-window>';
    expect(isGeminiPrivateModePage()).toBe(true);

    document.body.innerHTML = '<gem-icon-button data-test-id="temp-chat-button" class="temp-chat-on"></gem-icon-button>';
    expect(isGeminiPrivateModePage()).toBe(true);

    document.body.innerHTML = '<chat-window></chat-window>';
    expect(isGeminiPrivateModePage()).toBe(false);
  });
});
