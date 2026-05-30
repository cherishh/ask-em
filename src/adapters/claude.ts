import { getVisibleButtonTexts, isVisible, normalizeWhitespace } from './dom';
import { createDomProviderAdapter } from './factory';
import { readAttachmentFiles, setFileInputFiles } from './attachment-delivery';
import { getAttachmentExtension, PROVIDER_UPLOAD_CAPABILITIES, type AttachmentRef } from '../runtime/protocol';

export function isClaudeLoginRequiredPage(input: {
  pathname: string;
  buttonTexts: string[];
}): boolean {
  const pathname = input.pathname.toLowerCase();
  if (pathname.startsWith('/login')) {
    return true;
  }

  const buttonTexts = input.buttonTexts.map((text) => text.toLowerCase());

  return (
    buttonTexts.some((text) => text.includes('continue with google')) ||
    buttonTexts.some((text) => text.includes('continue with email')) ||
    buttonTexts.some((text) => text === 'console login') ||
    buttonTexts.some((text) => text === 'log in')
  );
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

function findClaudeFileInput(container: ParentNode, attachments: AttachmentRef[]): HTMLInputElement | null {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'))
    .filter((input) => !input.disabled);
  const preferredInputs = inputs.filter((input) => fileInputAcceptsAttachments(input, attachments));

  return (
    preferredInputs.find((input) => container instanceof Node && container.contains(input)) ??
    inputs.find((input) => container instanceof Node && container.contains(input)) ??
    preferredInputs[0] ??
    inputs[0] ??
    null
  );
}

function isClaudeUploadInput(input: HTMLInputElement): boolean {
  // Claude clears input.files after its own upload starts. Source capture must
  // catch this input's change event while the File objects are still available.
  return (
    input.type === 'file' &&
    !input.disabled &&
    (
      input.matches('input[data-testid="file-upload"]') ||
      input.matches('input[type="file"][aria-label*="upload" i]') ||
      input.accept.trim().length > 0
    )
  );
}

function findClaudeComposerRoot(composer: HTMLElement | null): ParentNode {
  let current: HTMLElement | null = composer;
  let sendButtonRoot: HTMLElement | null = null;

  while (current) {
    if (
      current.querySelector('input[data-testid="file-upload"], input[type="file"][aria-label*="upload" i]') ||
      current.querySelector('[data-testid="file-thumbnail"], button[aria-label^="remove " i]')
    ) {
      return current;
    }

    if (!sendButtonRoot && current.querySelector('button[aria-label="Send message"]')) {
      sendButtonRoot = current;
    }

    current = current.parentElement;
  }

  return sendButtonRoot ?? composer?.closest('form') ?? composer?.parentElement?.parentElement ?? document;
}

function getElementAccessibleText(element: HTMLElement): string {
  return normalizeWhitespace(
    [
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.getAttribute('alt'),
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

function getClaudeAttachmentCandidateTexts(container: ParentNode): string[] {
  if (!(container instanceof Element || container instanceof Document)) {
    return [];
  }

  const fileThumbnailItems = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="file-thumbnail"]'))
    .filter(isVisible)
    .map(getElementTreeAccessibleText)
    .filter(Boolean);

  // Claude document/PDF cards often expose the filename through per-file remove
  // buttons. Counting buttons preserves same-name duplicates better than a set
  // of filename keys.
  const removeButtonItems = Array.from(container.querySelectorAll<HTMLElement>('button[aria-label^="Remove " i]'))
    .filter(isVisible)
    .map(getElementAccessibleText)
    .filter(Boolean);
  const removeButtonTexts = removeButtonItems.map(compactAttachmentText);

  // Fallback for current Claude file cards where the only stable filename is
  // the thumbnail img alt text; this is not image-only logic. If a named remove
  // control already represents the same card, skip the img to avoid double
  // counting one PDF.
  const imageAltItems = Array.from(container.querySelectorAll<HTMLElement>('img[alt]'))
    .filter(isVisible)
    .map(getElementAccessibleText)
    .filter(Boolean)
    .filter((text) => {
      const compactText = compactAttachmentText(text);
      return !removeButtonTexts.some((removeText) => removeText.includes(compactText));
    });

  return [...fileThumbnailItems, ...removeButtonItems, ...imageAltItems];
}

function getClaudeAttachmentItems(container: ParentNode, expectedAttachments?: AttachmentRef[]): string[] {
  if (!(container instanceof Element || container instanceof Document)) {
    return [];
  }

  const expectedNames = (expectedAttachments ?? [])
    .map((attachment) => compactAttachmentText(attachment.name))
    .filter(Boolean);
  const candidates = getClaudeAttachmentCandidateTexts(container);

  if (expectedNames.length === 0) {
    return candidates;
  }

  const usedIndexes = new Set<number>();
  const matchedItems: string[] = [];
  for (const expectedName of expectedNames) {
    const matchedIndex = candidates.findIndex((candidate, index) => (
      !usedIndexes.has(index) &&
      compactAttachmentText(candidate).includes(expectedName)
    ));
    if (matchedIndex >= 0) {
      usedIndexes.add(matchedIndex);
      matchedItems.push(candidates[matchedIndex]);
    }
  }

  return matchedItems;
}

function findClaudeSendButton(findComposer: () => HTMLElement | null): HTMLElement | null {
  const composer = findComposer();
  const container = findClaudeComposerRoot(composer);
  const selectors = [
    'button[aria-label="Send message"]',
    'button[aria-label*="send" i]',
    'button[data-testid*="send" i]',
    'button[type="submit"]',
  ];

  for (const selector of selectors) {
    const button = Array.from(container.querySelectorAll<HTMLElement>(selector)).find(isVisible);
    if (button) {
      return button;
    }
  }

  return null;
}

function getClaudeFileThumbnailItems(container: ParentNode): string[] {
  return getClaudeAttachmentItems(container);
}

export const claudeAdapter = createDomProviderAdapter({
  provider: 'claude',
  uploadCapability: PROVIDER_UPLOAD_CAPABILITIES.claude,
  mountId: 'ask-em-claude-ui',
  className: 'ask-em-provider-ui ask-em-provider-ui-claude',
  classifyAuth() {
    const pathname = window.location.pathname;
    const buttonTexts = getVisibleButtonTexts();
    const isLoginRequired = isClaudeLoginRequiredPage({ pathname, buttonTexts });

    return {
      isLoginRequired,
      rule: pathname.toLowerCase().startsWith('/login')
        ? 'claude-auth-url'
        : isLoginRequired
          ? 'claude-auth-cta-cluster'
          : undefined,
      signals: `pathname=${pathname}; buttons=[${buttonTexts.slice(0, 6).join(' | ')}]`,
    };
  },
  composerSelectors: ['[data-testid="chat-input"]', '[aria-label="Write your prompt to Claude"]'],
  sendButtonSelectors: ['button[aria-label*="send" i]', 'button[data-testid*="send" i]', 'button[type="submit"]'],
  findSendButton: findClaudeSendButton,
  errorKeywords: ['conversation not found', 'something went wrong'],
  async setComposerPayload(payload, context) {
    await context.setComposerText(payload.text);

    if (payload.attachments.length === 0) {
      return;
    }

    const composer = context.findComposer();
    const root = findClaudeComposerRoot(composer);
    const fileInput = findClaudeFileInput(root, payload.attachments);

    if (!fileInput) {
      throw new Error('upload failed');
    }

    await setFileInputFiles(fileInput, await readAttachmentFiles(payload.attachments));
  },
  getComposerAttachmentPresence({ findComposer }, expectedAttachments) {
    const composer = findComposer();
    const container = findClaudeComposerRoot(composer);
    const fileThumbnailItems = getClaudeFileThumbnailItems(container);
    const removeButtons = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button[aria-label*="Remove"], button[aria-label*="remove"], [data-testid*="attachment"], [aria-label*="attachment"]',
      ),
    );
    const controlKeys = removeButtons
      .map((element) => element.getAttribute('aria-label') ?? element.textContent ?? '')
      .map((value) => value.trim())
      .filter(Boolean);
    const expectedKeys = getClaudeAttachmentItems(container, expectedAttachments);
    const keys = expectedKeys.length > 0 ? expectedKeys : Array.from(new Set([...controlKeys, ...fileThumbnailItems]));

    return {
      count: expectedKeys.length > 0
        ? expectedKeys.length
        : Math.max(fileThumbnailItems.length, removeButtons.length),
      keys,
    };
  },
  getComposerAttachmentSnapshot({ findComposer }, capturedAttachments) {
    const composer = findComposer();
    const container = findClaudeComposerRoot(composer);
    const fileThumbnailItems = getClaudeFileThumbnailItems(container);
    const expectedKeys = getClaudeAttachmentItems(container, capturedAttachments);
    const items = expectedKeys.length > 0 ? expectedKeys : fileThumbnailItems;

    return {
      count: items.length,
      items,
    };
  },
  isFileInputForComposer(input, { composer, sendButton }) {
    if (!isClaudeUploadInput(input)) {
      return false;
    }

    // Claude's upload input can be hidden outside the immediate editor subtree.
    // If the active page has a Claude composer/send button, treat this upload
    // input as composer-scoped instead of relying only on root.contains(input).
    const root = findClaudeComposerRoot(composer);
    return (
      (root instanceof Node && root.contains(input)) ||
      Boolean(composer) ||
      Boolean(sendButton)
    );
  },
  detectAttachmentUploadError() {
    const text = document.body?.innerText?.toLowerCase() ?? '';
    return text.includes('upload failed') || text.includes('failed to upload') ? 'upload failed' : null;
  },
});
