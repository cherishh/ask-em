import { createDomProviderAdapter } from './factory';

export const geminiAdapter = createDomProviderAdapter({
  provider: 'gemini',
  mountId: 'ask-em-gemini-ui',
  className: 'ask-em-provider-ui ask-em-provider-ui-gemini',
  composerSelectors: ['.ql-editor[role="textbox"]', '[aria-label="Enter a prompt for Gemini"]'],
  sendButtonSelectors: ['button.send-button[aria-label="Send message"]'],
  loginKeywords: ['sign in', 'log in', 'google account'],
  errorKeywords: ['something went wrong', 'try again in a bit'],
});
