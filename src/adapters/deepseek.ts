import { getVisibleButtonTexts, getVisibleInputDescriptors, isElementWithin, isVisible, normalizeWhitespace } from './dom';
import { createDomProviderAdapter } from './factory';
import { readAttachmentFiles, setFileInputFiles } from './attachment-delivery';
import { fileInputAcceptsAttachments, preferFileInputForAttachmentCount } from './file-input';
import { PROVIDER_UPLOAD_CAPABILITIES, type AttachmentRef } from '../runtime/protocol';

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

function findDeepseekComposerRoot(
  composer: HTMLElement | null,
  sendButton: HTMLElement | null,
): ParentNode {
  return (
    composer?.closest('div')?.parentElement?.parentElement ??
    sendButton?.parentElement?.parentElement ??
    composer?.parentElement?.parentElement?.parentElement ??
    composer?.parentElement?.parentElement ??
    document
  );
}

function findDeepseekFileInput(container: ParentNode, attachments: AttachmentRef[]): HTMLInputElement | null {
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

function getDeepseekComposerButtons(container: ParentNode): HTMLElement[] {
  if (!(container instanceof Element || container instanceof Document)) {
    return [];
  }

  return Array.from(container.querySelectorAll<HTMLElement>('button, [role="button"], .ds-button, .ds-icon-button'))
    .filter((element) => isVisible(element) && container.contains(element));
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

const DEEPSEEK_UPLOAD_ERROR_PATTERNS = [
  'unsupported file format',
  'unsupported file',
  'file type is not supported',
  'upload failed',
  'failed to upload',
  'could not upload',
  "couldn't upload",
  'error uploading',
  'file too large',
  'remove failed files',
  'failed files',
];

function isDeepseekUploadFailureText(text: string): boolean {
  const normalizedText = text.toLowerCase();
  return DEEPSEEK_UPLOAD_ERROR_PATTERNS.some((pattern) => normalizedText.includes(pattern));
}

function isDeepseekAttachmentReadyText(text: string, expectedName: string): boolean {
  if (isDeepseekUploadFailureText(text)) {
    return false;
  }

  // TODO(deepseek): Revisit this with a live upload-state capture. Manual zip testing showed
  // DeepSeek can expose a filename chip before the final rejection state, so this ready signal
  // must stay conservative and may need a stronger provider-specific success marker.
  const compactText = compactAttachmentText(text);
  const compactExpectedName = compactAttachmentText(expectedName);
  const textWithoutExpectedName = compactText.split(compactExpectedName).join('');

  return compactExpectedName.length > 0 &&
    compactText.includes(compactExpectedName) &&
    textWithoutExpectedName.length > 0;
}

function getDeepseekAttachmentItems(container: ParentNode, expectedAttachments?: AttachmentRef[]): string[] {
  if (!(container instanceof Element || container instanceof Document)) {
    return [];
  }

  const candidates = Array.from(container.querySelectorAll<HTMLElement>('.ds-animated-size-item'))
    .filter(isVisible)
    .map(getElementTreeAccessibleText)
    // DeepSeek keeps rejected files in the composer as red chips; they block submit and must not satisfy delivery presence.
    .filter((text) => !isDeepseekUploadFailureText(text))
    .filter(Boolean);
  const expectedNames = (expectedAttachments ?? []).map((attachment) => ({
    name: attachment.name,
    full: compactAttachmentText(attachment.name),
  })).filter((item) => item.full);

  if (expectedNames.length === 0) {
    return candidates;
  }

  const usedIndexes = new Set<number>();
  const matchedItems: string[] = [];
  for (const expectedName of expectedNames) {
    const matchedIndex = candidates.findIndex((candidate, index) => {
      if (usedIndexes.has(index)) {
        return false;
      }

      const compactCandidate = compactAttachmentText(candidate);
      return compactCandidate.includes(expectedName.full) &&
        isDeepseekAttachmentReadyText(candidate, expectedName.name);
    });

    if (matchedIndex >= 0) {
      usedIndexes.add(matchedIndex);
      matchedItems.push(expectedName.name);
    }
  }

  return matchedItems;
}

function detectDeepseekUploadErrorText(): string | null {
  const errorSelectors = [
    '[role="alert"]',
    '[aria-live]',
    '[class*="toast" i]',
    '[class*="error" i]',
    '[class*="notification" i]',
  ];
  const visibleTexts = [
    ...errorSelectors.flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector))),
    ...Array.from(document.querySelectorAll<HTMLElement>('.ds-animated-size-item')),
  ]
    .filter(isVisible)
    .map(getElementTreeAccessibleText)
    .filter(Boolean);

  return visibleTexts.some(isDeepseekUploadFailureText) ? 'upload failed' : null;
}

export const deepseekAdapter = createDomProviderAdapter({
  provider: 'deepseek',
  uploadCapability: PROVIDER_UPLOAD_CAPABILITIES.deepseek,
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
  composerSelectors: [
    'textarea[placeholder="Message DeepSeek"]',
    'textarea[placeholder="给 DeepSeek 发送消息 "]',
    'textarea[placeholder*="DeepSeek"]',
    'textarea[name="search"]',
  ],
  findSendButton(findComposer) {
    const composer = findComposer();
    const container = composer?.closest('div')?.parentElement;

    if (!container) {
      return null;
    }

    const buttons = getDeepseekComposerButtons(container);
    const primaryButton = buttons.find((element) =>
      element.classList.contains('ds-button--primary') &&
      element.classList.contains('ds-button--circle'),
    );

    return primaryButton ?? buttons.at(-1) ?? null;
  },
  errorKeywords: ['network error', 'something went wrong'],
  async setComposerPayload(payload, context) {
    await context.setComposerText(payload.text);

    if (payload.attachments.length === 0) {
      return;
    }

    const root = findDeepseekComposerRoot(context.findComposer(), context.findSendButton());
    const fileInput = findDeepseekFileInput(root, payload.attachments);

    if (!fileInput) {
      throw new Error('upload failed');
    }

    await setFileInputFiles(fileInput, await readAttachmentFiles(payload.attachments));
  },
  getComposerAttachmentPresence({ findComposer, findSendButton }, expectedAttachments) {
    const container = findDeepseekComposerRoot(findComposer(), findSendButton());
    const items = getDeepseekAttachmentItems(container, expectedAttachments);

    return {
      count: items.length,
      keys: items,
    };
  },
  getComposerAttachmentSnapshot({ findComposer, findSendButton }, capturedAttachments) {
    const container = findDeepseekComposerRoot(findComposer(), findSendButton());
    const items = getDeepseekAttachmentItems(container, capturedAttachments);

    return {
      count: items.length,
      items,
    };
  },
  isFileInputForComposer(input, { composer, sendButton }) {
    const root = findDeepseekComposerRoot(composer, sendButton);
    return Boolean(
      input.type === 'file' &&
      !input.disabled &&
      root instanceof Node &&
      root.contains(input),
    );
  },
  detectAttachmentUploadError() {
    return detectDeepseekUploadErrorText();
  },
  isSendButtonEnabled(button) {
    return button.getAttribute('aria-disabled') !== 'true' &&
      !button.hasAttribute('disabled') &&
      !button.classList.contains('ds-button--disabled');
  },
});
