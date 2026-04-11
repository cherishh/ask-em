import { isElementWithin } from './dom';
import { createDomProviderAdapter } from './factory';

export const deepseekAdapter = createDomProviderAdapter({
  provider: 'deepseek',
  mountId: 'ask-em-deepseek-ui',
  className: 'ask-em-provider-ui ask-em-provider-ui-deepseek',
  composerSelectors: ['textarea[placeholder="Message DeepSeek"]'],
  findSendButton(findComposer) {
    const composer = findComposer();
    const container = composer?.closest('div')?.parentElement;

    if (!container) {
      return null;
    }

    const buttons = Array.from(
      container.querySelectorAll<HTMLElement>('div.ds-icon-button[role="button"][aria-disabled]'),
    ).filter((element) => isElementWithin(element, container));

    return buttons.at(-1) ?? null;
  },
  loginKeywords: ['log in', 'sign in', 'phone number'],
  errorKeywords: ['network error', 'something went wrong'],
  isSendButtonEnabled(button) {
    return button.getAttribute('aria-disabled') !== 'true';
  },
});
