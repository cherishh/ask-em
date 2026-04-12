import { getVisibleButtonTexts, getVisibleHeadingTexts } from './dom';
import { createDomProviderAdapter } from './factory';

export function isChatgptLoginRequiredPage(input: {
  pathname: string;
  buttonTexts: string[];
  headingTexts: string[];
}): boolean {
  const pathname = input.pathname.toLowerCase();
  const buttonTexts = input.buttonTexts.map((text) => text.toLowerCase());
  const headingTexts = input.headingTexts.map((text) => text.toLowerCase());

  return (
    pathname.startsWith('/auth') ||
    pathname.startsWith('/login') ||
    headingTexts.includes('welcome back') ||
    headingTexts.includes('choose an account to continue') ||
    buttonTexts.includes('log in') ||
    buttonTexts.includes('sign up') ||
    buttonTexts.includes('sign up for free') ||
    buttonTexts.includes('continue with google') ||
    buttonTexts.includes('continue with microsoft') ||
    buttonTexts.includes('continue with apple')
  );
}

export const chatgptAdapter = createDomProviderAdapter({
  provider: 'chatgpt',
  mountId: 'ask-em-chatgpt-ui',
  className: 'ask-em-provider-ui ask-em-provider-ui-chatgpt',
  classifyAuth() {
    const pathname = window.location.pathname;
    const buttonTexts = getVisibleButtonTexts();
    const headingTexts = getVisibleHeadingTexts();
    const isLoginRequired = isChatgptLoginRequiredPage({
      pathname,
      buttonTexts,
      headingTexts,
    });

    return {
      isLoginRequired,
      rule: pathname.toLowerCase().startsWith('/auth') || pathname.toLowerCase().startsWith('/login')
        ? 'chatgpt-auth-url'
        : headingTexts.some((text) => text.toLowerCase() === 'welcome back')
          ? 'chatgpt-account-chooser-heading'
          : isLoginRequired
            ? 'chatgpt-auth-cta-cluster'
            : undefined,
      signals: `pathname=${pathname}; headings=[${headingTexts.slice(0, 4).join(' | ')}]; buttons=[${buttonTexts
        .slice(0, 8)
        .join(' | ')}]`,
    };
  },
  composerSelectors: ['#prompt-textarea', 'div[role="textbox"][aria-label="Chat with ChatGPT"]'],
  sendButtonSelectors: [
    '#composer-submit-button',
    'button[data-testid="send-button"]',
    'button[data-testid="composer-send-button"]',
    'form[aria-label="Chat with ChatGPT"] button[class*="composer-submit-button"]',
  ],
  errorKeywords: ['unable to load conversation', 'conversation not found'],
  submitWaitMs: 200,
  submitTimeoutMs: 2_500,
});
