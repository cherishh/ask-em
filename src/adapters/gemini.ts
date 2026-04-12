import { getVisibleButtonTexts } from './dom';
import { createDomProviderAdapter } from './factory';

export function isGeminiLoginRequiredPage(input: {
  pathname: string;
  buttonTexts: string[];
}): boolean {
  const pathname = input.pathname.toLowerCase();
  const buttonTexts = input.buttonTexts.map((text) => text.toLowerCase());

  return pathname === '/app' && buttonTexts.some((text) => text === 'sign in');
}

export const geminiAdapter = createDomProviderAdapter({
  provider: 'gemini',
  mountId: 'ask-em-gemini-ui',
  className: 'ask-em-provider-ui ask-em-provider-ui-gemini',
  classifyAuth() {
    const pathname = window.location.pathname;
    const buttonTexts = getVisibleButtonTexts();
    const isLoginRequired = isGeminiLoginRequiredPage({ pathname, buttonTexts });

    return {
      isLoginRequired,
      rule: isLoginRequired ? 'gemini-visible-sign-in-on-app' : undefined,
      signals: `pathname=${pathname}; buttons=[${buttonTexts.slice(0, 6).join(' | ')}]`,
    };
  },
  composerSelectors: ['.ql-editor[role="textbox"]', '[aria-label="Enter a prompt for Gemini"]'],
  sendButtonSelectors: ['button.send-button[aria-label="Send message"]'],
  errorKeywords: ['something went wrong', 'try again in a bit'],
});
