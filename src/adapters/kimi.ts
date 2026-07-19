import {
  detectHardErrorPage,
  getVisibleButtonTexts,
  isVisible,
  normalizeWhitespace,
} from './dom';
import { createDomProviderAdapter } from './factory';
import { PROVIDER_UPLOAD_CAPABILITIES } from '../runtime/protocol';

function isKimiAuthRoute(pathname: string): boolean {
  const normalized = pathname.toLowerCase();
  return (
    normalized.startsWith('/login') ||
    normalized.startsWith('/sign-in') ||
    normalized.startsWith('/signin') ||
    normalized.startsWith('/auth')
  );
}

export function isKimiChatRoute(url = window.location.href): boolean {
  try {
    const pathname = new URL(url, window.location.origin).pathname;
    if (pathname === '/chat/history' || pathname.startsWith('/chat/history/')) {
      return false;
    }

    return (
      pathname === '/' ||
      pathname === '/chat' ||
      pathname === '/chat/' ||
      /^\/chat\/[^/]+\/?$/.test(pathname)
    );
  } catch {
    return false;
  }
}

export function isKimiLoginRequiredPage(input: {
  pathname: string;
  buttonTexts: string[];
}): boolean {
  if (isKimiAuthRoute(input.pathname)) {
    return true;
  }

  const authLabels = new Set([
    'sign in',
    'log in',
    'continue with google',
    'continue with apple',
    'continue with email',
  ]);

  return input.buttonTexts.some((text) => authLabels.has(normalizeWhitespace(text).toLowerCase()));
}

function findKimiComposer(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '#chat-box .chat-input-editor[contenteditable="true"][role="textbox"], .chat-input-editor[contenteditable="true"][role="textbox"]',
  );
}

function findKimiComposerRoot(composer: HTMLElement | null): ParentNode {
  return composer?.closest('#chat-box') ?? composer?.closest('.chat-editor') ?? document;
}

function findKimiSendButton(composer: HTMLElement | null): HTMLElement | null {
  const root = findKimiComposerRoot(composer);
  if (!(root instanceof Element || root instanceof Document)) {
    return null;
  }

  return Array.from(root.querySelectorAll<HTMLElement>('.send-button-container')).find(isVisible) ?? null;
}

function setKimiComposerText(composer: HTMLElement | null, content: string): void {
  if (!composer) {
    throw new Error('Composer element not found');
  }

  composer.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(composer);
  selection?.removeAllRanges();
  selection?.addRange(range);

  if (typeof document.execCommand === 'function') {
    document.execCommand('selectAll', false);
    const updated = content
      ? document.execCommand('insertText', false, content)
      : document.execCommand('delete', false);
    if (updated) {
      // Lexical handles the native edit event itself. Dispatching a second input
      // event duplicates the text in Kimi's editor.
      return;
    }
  }

  composer.textContent = content;
  composer.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'insertText',
    data: content,
  }));
}

export const kimiAdapter = createDomProviderAdapter({
  provider: 'kimi',
  uploadCapability: PROVIDER_UPLOAD_CAPABILITIES.kimi,
  mountId: 'ask-em-kimi-ui',
  className: 'ask-em-provider-ui ask-em-provider-ui-kimi',
  isPageEligible() {
    return isKimiChatRoute() || isKimiAuthRoute(window.location.pathname);
  },
  classifyAuth() {
    const pathname = window.location.pathname;
    const buttonTexts = getVisibleButtonTexts();
    const isLoginRequired = isKimiLoginRequiredPage({ pathname, buttonTexts });

    return {
      isLoginRequired,
      rule: isKimiAuthRoute(pathname)
        ? 'kimi-auth-url'
        : isLoginRequired
          ? 'kimi-visible-auth-cta'
          : undefined,
      signals: `pathname=${pathname}; composer=${Boolean(findKimiComposer())}; buttons=[${buttonTexts.slice(0, 8).join(' | ')}]`,
    };
  },
  composerSelectors: [
    '#chat-box .chat-input-editor[contenteditable="true"][role="textbox"]',
    '.chat-input-editor[contenteditable="true"][role="textbox"]',
  ],
  findSendButton(findComposer) {
    return findKimiSendButton(findComposer());
  },
  isErrorPage() {
    return detectHardErrorPage({
      surfaceKeywords: [
        'conversation not found',
        'failed to load conversation',
        'something went wrong',
        'unable to load',
        'try again',
      ],
    });
  },
  setComposerPayload(payload, context) {
    if (payload.attachments.length > 0) {
      throw new Error('Provider does not support attachment delivery');
    }

    setKimiComposerText(context.findComposer(), payload.text);
  },
  isSendButtonEnabled(button) {
    return !button.classList.contains('disabled') && !button.hasAttribute('disabled');
  },
});
