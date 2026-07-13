import {
  detectHardErrorPage,
  getVisibleButtonTexts,
  isVisible,
  normalizeWhitespace,
} from './dom';
import { createDomProviderAdapter } from './factory';
import { readAttachmentFiles, setFileInputFiles } from './attachment-delivery';
import { PROVIDER_UPLOAD_CAPABILITIES, type CapturedAttachment } from '../runtime/protocol';
import type { ComposerAttachmentSnapshot } from './types';

function isGrokAuthRoute(pathname: string): boolean {
  const normalized = pathname.toLowerCase();
  return (
    normalized.startsWith('/login') ||
    normalized.startsWith('/sign-in') ||
    normalized.startsWith('/signin') ||
    normalized.startsWith('/auth')
  );
}

export function isGrokChatRoute(url = window.location.href): boolean {
  try {
    const pathname = new URL(url, window.location.origin).pathname;
    return pathname === '/' || pathname === '/c' || pathname === '/c/' || pathname.startsWith('/c/');
  } catch {
    return false;
  }
}

export function isGrokLoginRequiredPage(input: {
  pathname: string;
  buttonTexts: string[];
  hasComposer: boolean;
}): boolean {
  if (isGrokAuthRoute(input.pathname)) {
    return true;
  }

  if (input.hasComposer) {
    return false;
  }

  const authLabels = new Set([
    'sign in',
    'log in',
    'sign up',
    'create account',
    'continue with google',
    'continue with x',
    'continue with apple',
  ]);

  return input.buttonTexts.some((text) => authLabels.has(normalizeWhitespace(text).toLowerCase()));
}

export function isGrokPrivateModePage(): boolean {
  return Boolean(
    document.querySelector(
      'a[aria-label="Switch to Default Chat"], button[aria-label="Switch to Default Chat"]',
    ),
  );
}

function findGrokComposer(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-testid="chat-input"] [contenteditable="true"][role="textbox"], [contenteditable="true"][role="textbox"][aria-label="Ask Grok anything"]',
  );
}

function findGrokComposerRoot(composer: HTMLElement | null): ParentNode {
  return composer?.closest('form') ?? composer?.parentElement?.parentElement?.parentElement ?? document;
}

function getElementAccessibleText(element: HTMLElement): string {
  return normalizeWhitespace(
    [
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.innerText || element.textContent,
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function getGrokAttachmentItems(container: ParentNode): HTMLElement[] {
  if (!(container instanceof Element || container instanceof Document)) {
    return [];
  }

  return Array.from(
    container.querySelectorAll<HTMLElement>(
      '[role="list"][aria-label="Conversation attachments"] > [role="listitem"]',
    ),
  ).filter(isVisible);
}

function compactAttachmentText(value: string): string {
  return normalizeWhitespace(value).replace(/\s+/g, '').toLowerCase();
}

function getGrokAttachmentSnapshot(
  container: ParentNode,
  capturedAttachments: CapturedAttachment[],
): ComposerAttachmentSnapshot {
  const items = getGrokAttachmentItems(container);
  const labels = items.map(getElementAccessibleText).filter(Boolean);
  const matchedLabels = labels.filter((label) => {
    const compactLabel = compactAttachmentText(label);
    return capturedAttachments.some((attachment) => {
      const compactName = compactAttachmentText(attachment.name);
      return compactName.length > 0 && compactLabel.includes(compactName);
    });
  });

  if (matchedLabels.length === items.length) {
    return {
      count: items.length,
      items: matchedLabels,
    };
  }

  // Grok can rename pasted images or render image previews without the original
  // filename. Count-only fallback stays fail-closed unless the current card count
  // exactly matches the number of files captured for this submit.
  return {
    count: items.length,
  };
}

function getGrokUserMessageTexts(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="user-message"]'))
    .filter(isVisible)
    .map(getElementAccessibleText)
    .filter(Boolean);
}

function findGrokFileInput(container: ParentNode): HTMLInputElement | null {
  if (!(container instanceof Element || container instanceof Document)) {
    return null;
  }

  return Array.from(container.querySelectorAll<HTMLInputElement>('input[type="file"]'))
    .find((input) => !input.disabled) ?? null;
}

function detectGrokUploadErrorText(): string | null {
  const selectors = [
    '[role="alert"]',
    '[aria-live]',
    '[data-testid*="toast" i]',
    '[class*="toast" i]',
    '[class*="error" i]',
  ];
  const visibleText = selectors
    .flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)))
    .filter(isVisible)
    .map(getElementAccessibleText)
    .join(' ')
    .toLowerCase();
  const patterns = [
    'upload failed',
    'failed to upload',
    'could not upload',
    "couldn't upload",
    'unsupported file',
    'file too large',
    'error uploading',
  ];

  return patterns.some((pattern) => visibleText.includes(pattern)) ? 'upload failed' : null;
}

export const grokAdapter = createDomProviderAdapter({
  provider: 'grok',
  uploadCapability: PROVIDER_UPLOAD_CAPABILITIES.grok,
  mountId: 'ask-em-grok-ui',
  className: 'ask-em-provider-ui ask-em-provider-ui-grok',
  isPageEligible() {
    return isGrokChatRoute() || isGrokAuthRoute(window.location.pathname);
  },
  isPrivateMode: isGrokPrivateModePage,
  classifyAuth() {
    const pathname = window.location.pathname;
    const buttonTexts = getVisibleButtonTexts();
    const hasComposer = Boolean(findGrokComposer());
    const isLoginRequired = isGrokLoginRequiredPage({
      pathname,
      buttonTexts,
      hasComposer,
    });

    return {
      isLoginRequired,
      rule: isGrokAuthRoute(pathname)
        ? 'grok-auth-url'
        : isLoginRequired
          ? 'grok-visible-auth-cta'
          : undefined,
      signals: `pathname=${pathname}; composer=${hasComposer}; buttons=[${buttonTexts.slice(0, 8).join(' | ')}]`,
    };
  },
  composerSelectors: [
    '[data-testid="chat-input"] [contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][role="textbox"][aria-label="Ask Grok anything"]',
  ],
  sendButtonSelectors: [
    'button[data-testid="chat-submit"][aria-label="Submit"]',
    'form button[type="submit"][aria-label="Submit"]',
  ],
  getUserMessageTexts: getGrokUserMessageTexts,
  getComposerAttachmentSnapshot({ findComposer }, capturedAttachments) {
    return getGrokAttachmentSnapshot(
      findGrokComposerRoot(findComposer()),
      capturedAttachments,
    );
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
  async setComposerPayload(payload, context) {
    await context.setComposerText(payload.text);

    if (payload.attachments.length === 0) {
      return;
    }

    const composer = context.findComposer();
    const root = findGrokComposerRoot(composer);
    const fileInput = findGrokFileInput(root);
    if (!fileInput) {
      throw new Error('upload failed');
    }

    const files = await readAttachmentFiles(payload.attachments);
    await setFileInputFiles(fileInput, files);
  },
  getComposerAttachmentPresence({ findComposer }) {
    const items = getGrokAttachmentItems(findGrokComposerRoot(findComposer()));
    return {
      count: items.length,
      keys: items.map(getElementAccessibleText).filter(Boolean),
    };
  },
  detectAttachmentUploadError() {
    return detectGrokUploadErrorText();
  },
});
