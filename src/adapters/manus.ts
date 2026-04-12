import { findClickableByText, getVisibleButtonTexts, isVisible, triggerPointerClick } from './dom';
import { createDomProviderAdapter } from './factory';

function dismissManusOverlay(): void {
  const gotIt = findClickableByText('I got it') ?? findClickableByText('Got it');
  if (gotIt) {
    triggerPointerClick(gotIt);
    return;
  }

  const closeButton = Array.from(document.querySelectorAll<HTMLElement>('div')).find((element) => {
    if (!isVisible(element)) {
      return false;
    }

    const className = typeof element.className === 'string' ? element.className : '';
    return (
      className.includes('cursor-pointer') &&
      className.includes('rounded-full') &&
      Boolean(element.querySelector('svg.lucide-x'))
    );
  });

  if (closeButton) {
    triggerPointerClick(closeButton);
  }
}

export function isManusLoginRequiredPage(input: {
  pathname: string;
  buttonTexts: string[];
}): boolean {
  const pathname = input.pathname.toLowerCase();
  const buttonTexts = input.buttonTexts.map((text) => text.toLowerCase());
  const authCtaCount = buttonTexts.filter(
    (text) => text === 'sign in' || text === 'sign up' || text.startsWith('continue with '),
  ).length;

  if (pathname.startsWith('/login')) {
    return true;
  }

  if (pathname === '/' || pathname === '') {
    return authCtaCount > 0;
  }

  return authCtaCount >= 2;
}

export const manusAdapter = createDomProviderAdapter({
  provider: 'manus',
  mountId: 'ask-em-manus-ui',
  className: 'ask-em-provider-ui ask-em-provider-ui-manus',
  prepareDom: dismissManusOverlay,
  classifyAuth() {
    const pathname = window.location.pathname;
    const buttonTexts = getVisibleButtonTexts();
    const isLoginRequired = isManusLoginRequiredPage({
      pathname,
      buttonTexts,
    });

    return {
      isLoginRequired,
      rule: pathname.toLowerCase().startsWith('/login')
        ? 'manus-auth-url'
        : isLoginRequired
          ? 'manus-visible-nav-auth-cta'
          : undefined,
      signals: `pathname=${pathname}; buttons=[${buttonTexts.slice(0, 8).join(' | ')}]`,
    };
  },
  composerSelectors: ['.tiptap.ProseMirror'],
  findSendButton(findComposer) {
    const composer = findComposer();
    const container =
      composer?.closest<HTMLElement>('div[class*="rounded-"]') ??
      composer?.parentElement ??
      null;

    if (!container) {
      return null;
    }

    const buttons = Array.from(container.querySelectorAll<HTMLElement>('button')).filter((button) => {
      if (!isVisible(button)) {
        return false;
      }

      const className = typeof button.className === 'string' ? button.className : '';
      return (
        className.includes('Button-primary-black') ||
        className.includes('bg-[var(--Button-primary-black)]')
      );
    });

    return buttons.at(-1) ?? null;
  },
  errorKeywords: ['something went wrong', 'failed to load', 'try again'],
  submitWaitMs: 200,
  submitTimeoutMs: 3_000,
});
