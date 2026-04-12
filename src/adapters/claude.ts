import { getVisibleButtonTexts } from './dom';
import { createDomProviderAdapter } from './factory';

export function isClaudeLoginRequiredPage(input: {
  pathname: string;
  buttonTexts: string[];
}): boolean {
  const pathname = input.pathname.toLowerCase();
  if (pathname.startsWith('/login')) {
    return true;
  }

  const buttonTexts = input.buttonTexts.map((text) => text.toLowerCase());

  return (
    buttonTexts.some((text) => text.includes('continue with google')) ||
    buttonTexts.some((text) => text.includes('continue with email')) ||
    buttonTexts.some((text) => text === 'console login') ||
    buttonTexts.some((text) => text === 'log in')
  );
}

export const claudeAdapter = createDomProviderAdapter({
  provider: 'claude',
  mountId: 'ask-em-claude-ui',
  className: 'ask-em-provider-ui ask-em-provider-ui-claude',
  classifyAuth() {
    const pathname = window.location.pathname;
    const buttonTexts = getVisibleButtonTexts();
    const isLoginRequired = isClaudeLoginRequiredPage({ pathname, buttonTexts });

    return {
      isLoginRequired,
      rule: pathname.toLowerCase().startsWith('/login')
        ? 'claude-auth-url'
        : isLoginRequired
          ? 'claude-auth-cta-cluster'
          : undefined,
      signals: `pathname=${pathname}; buttons=[${buttonTexts.slice(0, 6).join(' | ')}]`,
    };
  },
  composerSelectors: ['[data-testid="chat-input"]', '[aria-label="Write your prompt to Claude"]'],
  sendButtonSelectors: ['button[aria-label="Send message"]'],
  errorKeywords: ['conversation not found', 'something went wrong'],
});
