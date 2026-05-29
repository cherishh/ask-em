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

function findClaudeComposerRoot(composer: HTMLElement | null): ParentNode {
  let current: HTMLElement | null = composer;
  let sendButtonRoot: HTMLElement | null = null;

  while (current) {
    if (
      current.querySelector('input[data-testid="file-upload"], input[type="file"][aria-label*="upload" i]') ||
      current.querySelector('[data-testid="file-thumbnail"]')
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
      element.innerText || element.textContent,
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function compactAttachmentText(value: string): string {
  return normalizeWhitespace(value).replace(/\s+/g, '').toLowerCase();
}

function getExpectedAttachmentKeys(container: ParentNode, expectedAttachments: AttachmentRef[] | undefined): string[] {
  if (!expectedAttachments || expectedAttachments.length === 0 || !(container instanceof Element || container instanceof Document)) {
    return [];
  }

  const candidates = Array.from(container.querySelectorAll<HTMLElement>('*'))
    .filter(isVisible)
    .filter((element) => {
      const compactText = compactAttachmentText(getElementAccessibleText(element));
      return expectedAttachments.some((attachment) => {
        const compactName = compactAttachmentText(attachment.name);
        return compactName.length > 0 && compactText.includes(compactName);
      });
    });

  return candidates
    .filter((candidate) => !candidates.some((other) => other !== candidate && candidate.contains(other)))
    .map(getElementAccessibleText)
    .filter(Boolean);
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
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="file-thumbnail"]'))
    .filter(isVisible)
    .map(getElementAccessibleText)
    .filter(Boolean);
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
    const expectedKeys = getExpectedAttachmentKeys(container, expectedAttachments);
    const keys = Array.from(new Set([...controlKeys, ...expectedKeys]));

    return {
      count: Math.max(fileThumbnailItems.length, removeButtons.length, expectedKeys.length),
      keys,
    };
  },
  getComposerAttachmentSnapshot({ findComposer }) {
    const composer = findComposer();
    const container = findClaudeComposerRoot(composer);
    const fileThumbnailItems = getClaudeFileThumbnailItems(container);

    return {
      count: fileThumbnailItems.length,
      items: fileThumbnailItems,
    };
  },
  detectAttachmentUploadError() {
    const text = document.body?.innerText?.toLowerCase() ?? '';
    return text.includes('upload failed') || text.includes('failed to upload') ? 'upload failed' : null;
  },
});
