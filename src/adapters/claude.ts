import { createDomProviderAdapter } from './factory';

export const claudeAdapter = createDomProviderAdapter({
  provider: 'claude',
  mountId: 'ask-em-claude-ui',
  className: 'ask-em-provider-ui ask-em-provider-ui-claude',
  composerSelectors: ['[data-testid="chat-input"]', '[aria-label="Write your prompt to Claude"]'],
  sendButtonSelectors: ['button[aria-label="Send message"]'],
  loginKeywords: ['log in', 'sign in', 'continue with google'],
  errorKeywords: ['conversation not found', 'something went wrong'],
});
