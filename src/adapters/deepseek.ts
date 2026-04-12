import { getVisibleButtonTexts, getVisibleInputDescriptors, isElementWithin } from './dom';
import { createDomProviderAdapter } from './factory';

export function isDeepseekLoginRequiredPage(input: {
  pathname: string;
  buttonTexts: string[];
  inputs: Array<{
    type: string | null;
    placeholder: string | null;
    ariaLabel: string | null;
  }>;
}): boolean {
  const pathname = input.pathname.toLowerCase();
  if (pathname.startsWith('/sign_in')) {
    return true;
  }

  const buttonTexts = input.buttonTexts.map((text) => text.toLowerCase());
  const hasLoginCtas =
    buttonTexts.some((text) => text === 'log in') &&
    buttonTexts.some((text) => text === 'sign up');
  const credentialInputs = input.inputs.filter((inputDescriptor) => {
    const haystack = [
      inputDescriptor.placeholder ?? '',
      inputDescriptor.ariaLabel ?? '',
      inputDescriptor.type ?? '',
    ]
      .join(' ')
      .toLowerCase();

    return (
      haystack.includes('phone number') ||
      haystack.includes('email') ||
      haystack.includes('password')
    );
  });

  return hasLoginCtas && credentialInputs.length >= 2;
}

export const deepseekAdapter = createDomProviderAdapter({
  provider: 'deepseek',
  mountId: 'ask-em-deepseek-ui',
  className: 'ask-em-provider-ui ask-em-provider-ui-deepseek',
  classifyAuth() {
    const pathname = window.location.pathname;
    const buttonTexts = getVisibleButtonTexts();
    const inputs = getVisibleInputDescriptors();
    const isLoginRequired = isDeepseekLoginRequiredPage({
      pathname,
      buttonTexts,
      inputs,
    });

    return {
      isLoginRequired,
      rule: pathname.toLowerCase().startsWith('/sign_in')
        ? 'deepseek-auth-url'
        : isLoginRequired
          ? 'deepseek-auth-form'
          : undefined,
      signals: `pathname=${pathname}; buttons=[${buttonTexts.slice(0, 6).join(' | ')}]; inputs=${inputs
        .map((input) => [input.type, input.placeholder, input.ariaLabel].filter(Boolean).join('/'))
        .slice(0, 4)
        .join(' | ')}`,
    };
  },
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
  errorKeywords: ['network error', 'something went wrong'],
  isSendButtonEnabled(button) {
    return button.getAttribute('aria-disabled') !== 'true';
  },
});
