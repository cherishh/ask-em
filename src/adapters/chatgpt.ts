import { createDomProviderAdapter } from './factory';

export const chatgptAdapter = createDomProviderAdapter({
  provider: 'chatgpt',
  mountId: 'ask-em-chatgpt-ui',
  className: 'ask-em-provider-ui ask-em-provider-ui-chatgpt',
  composerSelectors: ['#prompt-textarea', 'div[role="textbox"][aria-label="Chat with ChatGPT"]'],
  sendButtonSelectors: [
    '#composer-submit-button',
    'button[data-testid="send-button"]',
    'button[data-testid="composer-send-button"]',
    'form[aria-label="Chat with ChatGPT"] button[class*="composer-submit-button"]',
  ],
  loginKeywords: [
    'log in',
    'sign up',
    'continue with google',
    'welcome back',
    'choose an account to continue',
    'log in to another account',
    'create account',
  ],
  errorKeywords: ['unable to load conversation', 'conversation not found'],
  submitWaitMs: 200,
  submitTimeoutMs: 2_500,
});
