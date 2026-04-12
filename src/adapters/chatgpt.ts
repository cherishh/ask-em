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
  isLoginRequired() {
    return isChatgptLoginRequiredPage({
      pathname: window.location.pathname,
      buttonTexts: getVisibleButtonTexts(),
      headingTexts: getVisibleHeadingTexts(),
    });
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
