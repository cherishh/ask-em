import { getVisibleButtonTexts, isVisible, normalizeWhitespace } from './dom';
import { createDomProviderAdapter } from './factory';
import { dispatchPasteFiles, readAttachmentFiles } from './attachment-delivery';
import { PROVIDER_UPLOAD_CAPABILITIES, type AttachmentRef } from '../runtime/protocol';

export function isGeminiLoginRequiredPage(input: {
  pathname: string;
  buttonTexts: string[];
}): boolean {
  const pathname = input.pathname.toLowerCase();
  const buttonTexts = input.buttonTexts.map((text) => text.toLowerCase());

  return pathname === '/app' && buttonTexts.some((text) => text === 'sign in');
}

function findGeminiComposerRoot(
  composer: HTMLElement | null,
  sendButton: HTMLElement | null,
): ParentNode {
  return (
    composer?.closest('.text-input-field') ??
    composer?.closest('[data-test-id="textarea-inner"]')?.closest('.text-input-field') ??
    sendButton?.closest('.text-input-field') ??
    composer?.parentElement?.parentElement?.parentElement?.parentElement ??
    document
  );
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

function getElementTreeAccessibleText(element: HTMLElement): string {
  return normalizeWhitespace(
    [
      getElementAccessibleText(element),
      ...Array.from(element.querySelectorAll<HTMLElement>('*')).map(getElementAccessibleText),
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function compactAttachmentText(value: string): string {
  return normalizeWhitespace(value).replace(/\s+/g, '').toLowerCase();
}

function getAttachmentNameStem(name: string): string {
  const lastSegment = name.trim().split(/[\\/]/).at(-1) ?? '';
  const dotIndex = lastSegment.lastIndexOf('.');

  return dotIndex > 0 ? lastSegment.slice(0, dotIndex) : lastSegment;
}

function getGeminiAttachmentItems(container: ParentNode, expectedAttachments?: AttachmentRef[]): string[] {
  if (!(container instanceof Element || container instanceof Document)) {
    return [];
  }

  const expectedNames = (expectedAttachments ?? []).map((attachment) => ({
    name: attachment.name,
    full: compactAttachmentText(attachment.name),
    stem: compactAttachmentText(getAttachmentNameStem(attachment.name)),
  })).filter((item) => item.full || item.stem);
  const matchExpectedName = (text: string): string | null => {
    if (expectedNames.length === 0) {
      return text;
    }

    const compactText = compactAttachmentText(text);
    const match = expectedNames.find((item) => (
      (item.full && compactText.includes(item.full)) ||
      (item.stem && compactText.includes(item.stem))
    ));

    return match?.name ?? null;
  };
  const selectors = [
    'uploader-file-preview',
    'gem-attachment.gem-attachment-tile',
    '.file-preview-chip',
    '.gem-attachment-text',
  ];

  for (const selector of selectors) {
    const items = Array.from(container.querySelectorAll<HTMLElement>(selector))
      .filter(isVisible)
      .map(getElementTreeAccessibleText)
      .filter(Boolean)
      .map(matchExpectedName)
      .filter((item): item is string => Boolean(item));

    if (items.length > 0) {
      return items;
    }
  }

  return [];
}

function detectGeminiUploadErrorText(): string | null {
  const errorSelectors = [
    '[role="alert"]',
    '[aria-live]',
    '.mat-mdc-snack-bar-container',
    '[class*="snack" i]',
    '[class*="toast" i]',
    '[class*="error" i]',
  ];
  const visibleTexts = errorSelectors
    .flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)))
    .filter(isVisible)
    .map(getElementAccessibleText)
    .join(' ')
    .toLowerCase();
  const uploadErrorPatterns = [
    'upload failed',
    'failed to upload',
    'could not upload',
    "couldn't upload",
    'unsupported file',
    'file type is not supported',
    'file too large',
    'error uploading',
  ];

  return uploadErrorPatterns.some((pattern) => visibleTexts.includes(pattern)) ? 'upload failed' : null;
}

export const geminiAdapter = createDomProviderAdapter({
  provider: 'gemini',
  uploadCapability: PROVIDER_UPLOAD_CAPABILITIES.gemini,
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
  sendButtonSelectors: ['button[aria-label="Send message"]', 'button.send-button[aria-label="Send message"]'],
  errorKeywords: ['something went wrong', 'try again in a bit'],
  async setComposerPayload(payload, context) {
    await context.setComposerText(payload.text);

    if (payload.attachments.length === 0) {
      return;
    }

    const composer = context.findComposer();
    if (!composer) {
      throw new Error('upload failed');
    }

    dispatchPasteFiles(composer, await readAttachmentFiles(payload.attachments));
  },
  getComposerAttachmentPresence({ findComposer, findSendButton }, expectedAttachments) {
    const container = findGeminiComposerRoot(findComposer(), findSendButton());
    const items = getGeminiAttachmentItems(container, expectedAttachments);

    return {
      count: items.length,
      keys: items,
    };
  },
  getComposerAttachmentSnapshot({ findComposer, findSendButton }, capturedAttachments) {
    const container = findGeminiComposerRoot(findComposer(), findSendButton());
    const items = getGeminiAttachmentItems(container, capturedAttachments);

    return {
      count: items.length,
      items,
    };
  },
  detectAttachmentUploadError() {
    return detectGeminiUploadErrorText();
  },
});
