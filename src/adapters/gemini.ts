import { getVisibleButtonTexts, isVisible, normalizeWhitespace } from './dom';
import { createDomProviderAdapter } from './factory';
import { dispatchPasteFiles, readAttachmentFiles } from './attachment-delivery';
import { PROVIDER_UPLOAD_CAPABILITIES, type AttachmentRef } from '../runtime/protocol';

const GEMINI_ATTACHMENT_READY_TIMEOUT_MS = 30_000;
const GEMINI_ATTACHMENT_READY_POLL_MS = 250;
const GEMINI_ATTACHMENT_READY_STABLE_MS = 5_000;

export function isGeminiLoginRequiredPage(input: {
  pathname: string;
  buttonTexts: string[];
}): boolean {
  const pathname = input.pathname.toLowerCase();
  const buttonTexts = input.buttonTexts.map((text) => text.toLowerCase());

  return pathname === '/app' && buttonTexts.some((text) => text === 'sign in');
}

export function isGeminiPrivateModePage(): boolean {
  return Boolean(
    document.querySelector('chat-window.is-temporary-chat') ||
    document.querySelector('[data-test-id="temp-chat-button"].temp-chat-on'),
  );
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
  const describedByText = (element.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .filter(Boolean)
    .join(' ');

  return normalizeWhitespace(
    [
      element.getAttribute('aria-label'),
      describedByText,
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
  const matchExpectedNames = (candidateTexts: string[]): string[] => {
    if (expectedNames.length === 0) {
      return candidateTexts;
    }

    const usedIndexes = new Set<number>();
    let matchedExpectedCount = 0;
    for (const expectedName of expectedNames) {
      const matchedIndex = candidateTexts.findIndex((text, index) => {
        if (usedIndexes.has(index)) {
          return false;
        }

        const compactText = compactAttachmentText(text);
        return (
          (expectedName.full && compactText.includes(expectedName.full)) ||
          (expectedName.stem && compactText.includes(expectedName.stem))
        );
      });

      if (matchedIndex >= 0) {
        usedIndexes.add(matchedIndex);
        matchedExpectedCount += 1;
      }
    }

    if (matchedExpectedCount < expectedNames.length) {
      return [];
    }

    return candidateTexts.flatMap((text) => {
      const compactText = compactAttachmentText(text);
      const matchedExpected = expectedNames.find((expectedName) => (
        (expectedName.full && compactText.includes(expectedName.full)) ||
        (expectedName.stem && compactText.includes(expectedName.stem))
      ));

      return matchedExpected ? [matchedExpected.name] : [];
    });
  };
  const selectors = [
    '.gem-attachment-text',
    'gem-attachment.gem-attachment-tile',
    '.file-preview-chip',
    'uploader-file-preview',
  ];

  for (const selector of selectors) {
    const candidateTexts = Array.from(container.querySelectorAll<HTMLElement>(selector))
      .filter(isVisible)
      .map(getElementTreeAccessibleText)
      .filter(Boolean);
    const items = matchExpectedNames(candidateTexts);

    if (
      (expectedNames.length === 0 && items.length > 0) ||
      (expectedNames.length > 0 && items.length >= expectedNames.length)
    ) {
      return items;
    }
  }

  return [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function isGeminiSendButtonEnabled(button: HTMLElement | null): boolean {
  if (!button || !isVisible(button)) {
    return false;
  }

  const stateElement = button.closest<HTMLElement>('gem-icon-button.send-button, .send-button') ?? button;
  const className = typeof button.className === 'string' ? button.className.toLowerCase() : '';
  const stateClassName = typeof stateElement.className === 'string' ? stateElement.className.toLowerCase() : '';

  return (
    !button.hasAttribute('disabled') &&
    button.getAttribute('aria-disabled') !== 'true' &&
    button.getAttribute('data-disabled') !== 'true' &&
    !className.includes('disabled') &&
    !stateElement.hasAttribute('disabled') &&
    stateElement.getAttribute('aria-disabled') !== 'true' &&
    stateElement.getAttribute('data-disabled') !== 'true' &&
    !stateClassName.includes('disabled')
  );
}

async function waitForGeminiAttachmentOnlySubmitReady(
  context: {
    findComposer: () => HTMLElement | null;
    findSendButton: () => HTMLElement | null;
  },
  expectedAttachments: AttachmentRef[],
  baselineCount: number,
): Promise<void> {
  const deadline = Date.now() + GEMINI_ATTACHMENT_READY_TIMEOUT_MS;
  const expectedCount = baselineCount + expectedAttachments.length;
  let readySince: number | null = null;

  while (Date.now() <= deadline) {
    const uploadError = detectGeminiUploadErrorText();
    if (uploadError) {
      throw new Error(uploadError);
    }

    const container = findGeminiComposerRoot(context.findComposer(), context.findSendButton());
    const items = getGeminiAttachmentItems(container, expectedAttachments);
    const isReady = items.length >= expectedCount && isGeminiSendButtonEnabled(context.findSendButton());
    if (!isReady) {
      readySince = null;
    } else {
      readySince ??= Date.now();
      if (Date.now() - readySince >= GEMINI_ATTACHMENT_READY_STABLE_MS) {
        return;
      }
    }

    await sleep(GEMINI_ATTACHMENT_READY_POLL_MS);
  }

  throw new Error('upload failed');
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
  isPrivateMode: isGeminiPrivateModePage,
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
  sendButtonSelectors: [
    'button[aria-label="Send message"]',
    'button[aria-label="发送"]',
    'gem-icon-button.send-button button[aria-label="Send message"]',
    'gem-icon-button.send-button button[aria-label="发送"]',
    'gem-icon-button.send-button button',
    'button.send-button[aria-label="Send message"]',
    'button.send-button[aria-label="发送"]',
    'gem-icon-button.send-button',
  ],
  isSendButtonEnabled: isGeminiSendButtonEnabled,
  errorKeywords: ['something went wrong', 'try again in a bit'],
  async setComposerPayload(payload, context) {
    if (payload.attachments.length === 0) {
      await context.setComposerText(payload.text);
      return;
    }

    await context.setComposerText('');
    const composer = context.findComposer();
    if (!composer) {
      throw new Error('upload failed');
    }

    const baselineContainer = findGeminiComposerRoot(composer, context.findSendButton());
    const baselineCount = getGeminiAttachmentItems(baselineContainer, payload.attachments).length;
    // TODO: Gemini accepts MP4 through trusted user paste, but synthetic paste does
    // not currently create the video attachment. A transient Upload files route
    // still returns `upload input not found`; revisit with a Gemini-specific
    // xapfileselectortrigger bridge. Keep synthetic paste for documents/images.
    dispatchPasteFiles(composer, await readAttachmentFiles(payload.attachments));
    await waitForGeminiAttachmentOnlySubmitReady(context, payload.attachments, baselineCount);
    await context.setComposerText(payload.text);
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
