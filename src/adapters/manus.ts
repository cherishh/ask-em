import { findClickableByText, isVisible, triggerPointerClick } from './dom';
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

export const manusAdapter = createDomProviderAdapter({
  provider: 'manus',
  mountId: 'ask-em-manus-ui',
  className: 'ask-em-provider-ui ask-em-provider-ui-manus',
  prepareDom: dismissManusOverlay,
  isLoginRequired() {
    if (window.location.pathname.startsWith('/login')) {
      return true;
    }

    const authCtas = Array.from(document.querySelectorAll<HTMLElement>('a, button')).filter((element) => {
      if (!isVisible(element)) {
        return false;
      }

      const text = (element.innerText || element.textContent || '').trim().toLowerCase();
      return text === 'sign in' || text === 'sign up' || text.startsWith('continue with ');
    });

    return authCtas.length >= 2;
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
  loginKeywords: [
    'sign in or sign up',
    'sign in',
    'sign up',
    'continue with google',
    'continue with apple',
    'continue with microsoft',
    'verify you are human',
  ],
  errorKeywords: ['something went wrong', 'failed to load', 'try again'],
  submitWaitMs: 200,
  submitTimeoutMs: 3_000,
});
