import { getVisibleButtonTexts, getVisibleInputDescriptors, isElementWithin, isVisible, normalizeWhitespace } from './dom';
import { createDomProviderAdapter } from './factory';
import { readAttachmentFiles, setFileInputFiles } from './attachment-delivery';
import { getAttachmentExtension, PROVIDER_UPLOAD_CAPABILITIES, type AttachmentRef } from '../runtime/protocol';

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

function fileInputAcceptsAttachments(input: HTMLInputElement, attachments: AttachmentRef[]): boolean {
  const accept = input.getAttribute('accept')?.trim().toLowerCase();
  if (!accept) {
    return true;
  }

  const tokens = accept.split(',').map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0) {
    return true;
  }

  return attachments.every((attachment) => {
    const mime = attachment.mime.trim().toLowerCase();
    const extension = getAttachmentExtension(attachment.name);

    return tokens.some((token) => {
      if (extension && token === `.${extension}`) {
        return true;
      }

      if (mime && token === mime) {
        return true;
      }

      return token.endsWith('/*') && mime.startsWith(`${token.slice(0, -1)}`);
    });
  });
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
    preferredScopedInputs.find((input) => input.multiple || attachments.length <= 1) ??
    preferredScopedInputs[0] ??
    unrestrictedScopedInputs.find((input) => input.multiple || attachments.length <= 1) ??
    unrestrictedScopedInputs[0] ??
    null
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

function getDeepseekAttachmentItems(container: ParentNode, expectedAttachments?: AttachmentRef[]): string[] {
  if (!(container instanceof Element || container instanceof Document)) {
    return [];
  }

  const candidates = Array.from(container.querySelectorAll<HTMLElement>('.ds-animated-size-item'))
    .filter(isVisible)
    .map(getElementTreeAccessibleText)
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
      return expectedName.full.length > 0 && compactCandidate.includes(expectedName.full);
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
    return button.getAttribute('aria-disabled') !== 'true';
  },
});
