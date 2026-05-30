import { getVisibleButtonTexts, getVisibleHeadingTexts, isVisible, normalizeWhitespace } from './dom';
import { createDomProviderAdapter } from './factory';
import { dispatchPasteFiles, readAttachmentFiles, setFileInputFiles } from './attachment-delivery';
import { fileInputAcceptsAttachments, preferFileInputForAttachmentCount } from './file-input';
import { PROVIDER_UPLOAD_CAPABILITIES, type AttachmentRef } from '../runtime/protocol';

const CHATGPT_PASTED_TEXT_ATTACHMENT_MIN_CHARS = 5_000;

export function isChatgptLoginRequiredPage(input: {
  pathname: string;
  buttonTexts: string[];
  headingTexts: string[];
}): boolean {
  const pathname = input.pathname.toLowerCase();
  const buttonTexts = input.buttonTexts.map((text) => text.toLowerCase());
  const headingTexts = input.headingTexts.map((text) => text.toLowerCase());

  return (
    pathname.startsWith('/auth') ||
    pathname.startsWith('/login') ||
    headingTexts.includes('welcome back') ||
    headingTexts.includes('choose an account to continue') ||
    buttonTexts.includes('log in') ||
    buttonTexts.includes('sign up') ||
    buttonTexts.includes('sign up for free') ||
    buttonTexts.includes('continue with google') ||
    buttonTexts.includes('continue with microsoft') ||
    buttonTexts.includes('continue with apple')
  );
}

function findChatgptComposerRoot(
  composer: HTMLElement | null,
  sendButton: HTMLElement | null,
): ParentNode {
  return (
    composer?.closest('form[data-type="unified-composer"]') ??
    composer?.closest('form') ??
    sendButton?.closest('form') ??
    composer?.closest('[data-composer-surface="true"]') ??
    composer?.parentElement?.parentElement?.parentElement ??
    document
  );
}

function findChatgptFileInput(container: ParentNode, attachments: AttachmentRef[]): HTMLInputElement | null {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'))
    .filter((input) => !input.disabled);
  const scopedInputs = inputs.filter((input) => container instanceof Node && container.contains(input));
  const preferredScopedInputs = scopedInputs.filter((input) => fileInputAcceptsAttachments(input, attachments));
  const unrestrictedScopedInputs = scopedInputs.filter((input) => !input.getAttribute('accept'));

  return (
    preferFileInputForAttachmentCount(preferredScopedInputs, attachments.length) ??
    preferFileInputForAttachmentCount(unrestrictedScopedInputs, attachments.length) ??
    preferFileInputForAttachmentCount(scopedInputs, attachments.length)
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

function compactAttachmentText(value: string): string {
  return normalizeWhitespace(value).replace(/\s+/g, '').toLowerCase();
}

// True when an element's accessible text exposes a filename token (e.g. a file
// tile labeled "old.pdf"). Image tiles expose no filename ("Uploaded image"), so
// they return false. Used to tell a non-matching NAMED draft (skip — it is a
// different file) apart from a filename-less image (count — it may be the file we
// are waiting for) when expected-filename matching finds nothing.
function exposesFilename(element: HTMLElement): boolean {
  return /[^\s/\\]+\.[a-z0-9]{1,8}\b/i.test(getElementAccessibleText(element));
}

function getExpectedAttachmentElements(
  container: ParentNode,
  expectedAttachments: AttachmentRef[] | undefined,
): HTMLElement[] {
  if (!expectedAttachments || expectedAttachments.length === 0 || !(container instanceof Element || container instanceof Document)) {
    return [];
  }

  const compactNames = expectedAttachments
    .map((attachment) => compactAttachmentText(attachment.name))
    .filter(Boolean);
  if (compactNames.length === 0) {
    return [];
  }

  const candidates = Array.from(container.querySelectorAll<HTMLElement>('*'))
    .filter(isVisible)
    .filter((element) => {
      const compactText = compactAttachmentText(getElementAccessibleText(element));
      return compactNames.some((name) => compactText.includes(name));
    })
    .map((element) => (
      element.closest<HTMLElement>('[role="group"][aria-label], [class*="group/file-tile" i]') ?? element
    ))
    .filter((element, index, elements) => elements.indexOf(element) === index);

  return candidates.filter(
    (candidate) => !candidates.some((other) => other !== candidate && candidate.contains(other)),
  );
}

function getGenericAttachmentElementRoot(element: HTMLElement): HTMLElement {
  return (
    element.closest<HTMLElement>(
      '[role="group"][aria-label], [class*="group/file-tile" i], [data-testid*="file-preview" i], [data-testid*="attachment" i], [data-testid*="image" i]',
    ) ?? element
  );
}

function getGenericAttachmentElements(container: ParentNode): HTMLElement[] {
  if (!(container instanceof Element || container instanceof Document)) {
    return [];
  }

  const selectors = [
    '[role="group"][aria-label]',
    'button[aria-label^="Remove file" i]',
    'button[aria-label*="remove" i][aria-label*="attachment" i]',
    '[class*="group/file-tile" i]',
    '[data-testid*="file-preview" i]',
    '[data-testid*="attachment" i]',
    '[data-testid*="image" i]',
    'img[src^="blob:"]',
    'img[alt*="uploaded" i]',
    'img[alt*="attachment" i]',
  ];
  const candidates = selectors.flatMap((selector) => Array.from(container.querySelectorAll<HTMLElement>(selector)))
    .filter((element, index, elements) => elements.indexOf(element) === index)
    .filter(isVisible)
    .filter((element) => {
      const text = getElementAccessibleText(element).toLowerCase();
      const tagName = element.tagName.toLowerCase();
      const className = typeof element.className === 'string' ? element.className.toLowerCase() : '';
      const testId = element.getAttribute('data-testid')?.toLowerCase() ?? '';
      return (
        text.includes('.') ||
        text.includes('remove file') ||
        text.includes('uploaded') ||
        text.includes('attachment') ||
        className.includes('file-tile') ||
        testId.includes('file') ||
        testId.includes('attachment') ||
        testId.includes('image') ||
        (tagName === 'img' && element instanceof HTMLImageElement && element.src.startsWith('blob:'))
      );
    })
    .map(getGenericAttachmentElementRoot)
    .filter((element, index, elements) => elements.indexOf(element) === index);

  return candidates.filter(
    (candidate) => !candidates.some((other) => other !== candidate && candidate.contains(other)),
  );
}

function detectChatgptUploadErrorText(): string | null {
  const errorSelectors = [
    '[role="alert"]',
    '[aria-live]',
    '[data-testid*="toast" i]',
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
    'file too large',
    'something went wrong uploading',
    'error uploading',
  ];

  return uploadErrorPatterns.some((pattern) => visibleTexts.includes(pattern)) ? 'upload failed' : null;
}

export const chatgptAdapter = createDomProviderAdapter({
  provider: 'chatgpt',
  uploadCapability: PROVIDER_UPLOAD_CAPABILITIES.chatgpt,
  pastedTextAttachmentMinChars: CHATGPT_PASTED_TEXT_ATTACHMENT_MIN_CHARS,
  mountId: 'ask-em-chatgpt-ui',
  className: 'ask-em-provider-ui ask-em-provider-ui-chatgpt',
  classifyAuth() {
    const pathname = window.location.pathname;
    const buttonTexts = getVisibleButtonTexts();
    const headingTexts = getVisibleHeadingTexts();
    const isLoginRequired = isChatgptLoginRequiredPage({
      pathname,
      buttonTexts,
      headingTexts,
    });

    return {
      isLoginRequired,
      rule: pathname.toLowerCase().startsWith('/auth') || pathname.toLowerCase().startsWith('/login')
        ? 'chatgpt-auth-url'
        : headingTexts.some((text) => text.toLowerCase() === 'welcome back')
          ? 'chatgpt-account-chooser-heading'
          : isLoginRequired
            ? 'chatgpt-auth-cta-cluster'
            : undefined,
      signals: `pathname=${pathname}; headings=[${headingTexts.slice(0, 4).join(' | ')}]; buttons=[${buttonTexts
        .slice(0, 8)
        .join(' | ')}]`,
    };
  },
  composerSelectors: ['#prompt-textarea', 'div[role="textbox"][aria-label="Chat with ChatGPT"]'],
  sendButtonSelectors: [
    '#composer-submit-button',
    'button[data-testid="send-button"]',
    'button[data-testid="composer-send-button"]',
    'button[aria-label="Send prompt"]',
    'form[aria-label="Chat with ChatGPT"] button[class*="composer-submit-button"]',
  ],
  errorKeywords: ['unable to load conversation', 'conversation not found'],
  async setComposerPayload(payload, context) {
    await context.setComposerText(payload.text);

    if (payload.attachments.length === 0) {
      return;
    }

    const composer = context.findComposer();
    const root = findChatgptComposerRoot(composer, context.findSendButton());
    const fileInput = findChatgptFileInput(root, payload.attachments);
    const files = await readAttachmentFiles(payload.attachments);

    if (fileInput) {
      await setFileInputFiles(fileInput, files);
      return;
    }

    if (!composer) {
      throw new Error('upload failed');
    }

    dispatchPasteFiles(composer, files);
  },
  getComposerAttachmentPresence({ findComposer, findSendButton }, expectedAttachments) {
    const container = findChatgptComposerRoot(findComposer(), findSendButton());

    if (!expectedAttachments || expectedAttachments.length === 0) {
      const generic = getGenericAttachmentElements(container);
      return {
        count: generic.length,
        keys: Array.from(new Set(generic.map(getElementAccessibleText).filter(Boolean))),
      };
    }

    // Count filename-matched expected tiles, PLUS filename-less generic tiles
    // (ChatGPT image previews expose no filename). The union is required for a
    // MIXED fan-out such as report.pdf + image.jpg: the pdf confirms by filename
    // match while the image is only countable as a filename-less tile — counting
    // only one set would leave the other uploaded file forever short of the delta
    // and time out. A NAMED tile that does not match an expected filename is a
    // different/stale draft, so it lands in neither set and is correctly excluded.
    const expectedElements = getExpectedAttachmentElements(container, expectedAttachments);
    const expectedSet = new Set(expectedElements);
    const filenamelessGeneric = getGenericAttachmentElements(container).filter(
      (element) =>
        !exposesFilename(element) &&
        !expectedSet.has(element) &&
        !expectedElements.some((expected) => expected.contains(element) || element.contains(expected)),
    );
    const elements = [...expectedElements, ...filenamelessGeneric];
    const keys = Array.from(new Set(elements.map(getElementAccessibleText).filter(Boolean)));

    return {
      count: elements.length,
      keys,
    };
  },
  getComposerAttachmentSnapshot({ findComposer, findSendButton }, capturedAttachments) {
    const container = findChatgptComposerRoot(findComposer(), findSendButton());
    const elements = getExpectedAttachmentElements(container, capturedAttachments);

    if (elements.length > 0) {
      return {
        count: elements.length,
        items: elements.map(getElementAccessibleText).filter(Boolean),
      };
    }

    const genericElements = getGenericAttachmentElements(container);
    if (genericElements.length > 0) {
      return {
        count: genericElements.length,
        items: [],
      };
    }

    const scopedFileInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'))
      .filter((input) => container instanceof Node && container.contains(input));
    if (scopedFileInputs.length > 0 && capturedAttachments.every((attachment) => attachment.source === 'file-input')) {
      return {
        count: 0,
        items: [],
      };
    }

    return null;
  },
  detectAttachmentUploadError() {
    return detectChatgptUploadErrorText();
  },
  submitWaitMs: 200,
  submitTimeoutMs: 2_500,
});
