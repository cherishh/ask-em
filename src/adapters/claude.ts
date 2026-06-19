import { detectHardErrorPage, getVisibleButtonTexts, isVisible, normalizeWhitespace } from './dom';
import { createDomProviderAdapter } from './factory';
import { readAttachmentFiles, setFileInputFiles } from './attachment-delivery';
import { fileInputAcceptsAttachments, preferFileInputForAttachmentCount } from './file-input';
import { PROVIDER_UPLOAD_CAPABILITIES, type AttachmentRef, type CapturedAttachment } from '../runtime/protocol';

const CLAUDE_PASTED_TEXT_ATTACHMENT_MIN_CHARS = 5_000;

function detectClaudeUploadErrorText(): string | null {
  // Scope to alert/toast/error surfaces. Reading document.body.innerText would
  // also scan the just-injected synced prompt and the whole conversation
  // transcript, so a prompt or prior message containing "upload failed" would
  // spuriously fail an attachment delivery that actually succeeded.
  const errorSelectors = [
    '[role="alert"]',
    '[aria-live]',
    '[data-testid*="toast" i]',
    '[class*="toast" i]',
    '[class*="error" i]',
  ];
  const visibleText = errorSelectors
    .flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)))
    .filter(isVisible)
    .map((element) =>
      normalizeWhitespace(
        [element.getAttribute('aria-label'), element.getAttribute('title'), element.innerText || element.textContent]
          .filter(Boolean)
          .join(' '),
      ),
    )
    .join(' ')
    .toLowerCase();

  return visibleText.includes('upload failed') || visibleText.includes('failed to upload') ? 'upload failed' : null;
}

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

export function isClaudePrivateModePage(url: string): boolean {
  try {
    return new URL(url).searchParams.has('incognito');
  } catch {
    return false;
  }
}

function findClaudeFileInput(container: ParentNode, attachments: AttachmentRef[]): HTMLInputElement | null {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'))
    .filter((input) => !input.disabled);
  const scopedInputs = inputs.filter((input) => container instanceof Node && container.contains(input));
  const preferredInputs = inputs.filter((input) => fileInputAcceptsAttachments(input, attachments));
  const preferredScopedInputs = scopedInputs.filter((input) => fileInputAcceptsAttachments(input, attachments));

  return (
    preferFileInputForAttachmentCount(preferredScopedInputs, attachments.length) ??
    preferFileInputForAttachmentCount(scopedInputs, attachments.length) ??
    preferFileInputForAttachmentCount(preferredInputs, attachments.length) ??
    preferFileInputForAttachmentCount(inputs, attachments.length)
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

function hasClaudeSubmittableContent(
  composer: HTMLElement | null,
  container: ParentNode,
): boolean {
  if (normalizeWhitespace(composer?.innerText || composer?.textContent || '').length > 0) {
    return true;
  }

  return (
    (container instanceof Element || container instanceof Document) &&
    container.querySelector('[data-testid="file-thumbnail"]') !== null
  );
}

function isClaudeSubmitCandidateButton(button: HTMLElement): boolean {
  if (!isClaudeExplicitSendButton(button)) {
    return false;
  }

  const rect = button.getBoundingClientRect();
  return rect.width <= 72 && rect.height <= 72;
}

function isClaudeExplicitSendButton(button: HTMLElement): boolean {
  if (!isVisible(button) || button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true') {
    return false;
  }

  if (button.closest("[id^='ask-em-'], .ask-em-sync-shell")) {
    return false;
  }

  if (button.getAttribute('data-testid') === 'model-selector-dropdown') {
    return false;
  }

  if (isClaudeNonSendControlButton(button)) {
    return false;
  }

  return true;
}

function isClaudeNonSendControlButton(button: HTMLElement): boolean {
  const text = compactAttachmentText(getElementTreeAccessibleText(button));
  const testId = compactAttachmentText(button.getAttribute('data-testid') ?? '');
  const combined = `${text} ${testId}`;
  const nonSendSignals = [
    'addfiles',
    'audio',
    'connectors',
    'configuracion',
    'done',
    'dictation',
    'finish',
    'finishdictation',
    'grabar',
    'microphone',
    'model',
    'record',
    'settings',
    'stop',
    'turnoffmicrophone',
    'usevoicemode',
    'voicemode',
    '录音',
    '语音',
    '麦克风',
  ];

  return nonSendSignals.some((signal) => combined.includes(signal));
}

function isClaudeDictationSubmitButton(button: HTMLElement): boolean {
  const text = compactAttachmentText(getElementTreeAccessibleText(button));
  const testId = compactAttachmentText(button.getAttribute('data-testid') ?? '');
  const combined = `${text} ${testId}`;

  return combined.includes('submitdictation');
}

function isBasicEnabledButton(button: HTMLElement): boolean {
  return (
    isVisible(button) &&
    !button.hasAttribute('disabled') &&
    button.getAttribute('aria-disabled') !== 'true'
  );
}

function isClaudeUserSubmitButtonEnabled(button: HTMLElement): boolean {
  return isClaudeDictationSubmitButton(button)
    ? isBasicEnabledButton(button)
    : isClaudeExplicitSendButton(button);
}

function findClaudeSendButtonByComposerLayout(
  composer: HTMLElement | null,
  container: ParentNode,
): HTMLElement | null {
  if (
    !composer ||
    !(container instanceof Element || container instanceof Document) ||
    !hasClaudeSubmittableContent(composer, container)
  ) {
    return null;
  }

  const composerRect = composer.getBoundingClientRect();
  const containerRect = container instanceof Element ? container.getBoundingClientRect() : null;
  const buttons = Array.from(container.querySelectorAll<HTMLElement>('button'))
    .filter(isClaudeSubmitCandidateButton)
    .filter((button) => {
      const rect = button.getBoundingClientRect();
      if (rect.top < composerRect.bottom - 12) {
        return false;
      }

      if (containerRect && (rect.left < containerRect.left - 4 || rect.right > containerRect.right + 4)) {
        return false;
      }

      return true;
    })
    .sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return rightRect.right - leftRect.right || rightRect.left - leftRect.left;
    });

  return buttons[0] ?? null;
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
    const button = Array.from(container.querySelectorAll<HTMLElement>(selector)).find(isClaudeExplicitSendButton);
    if (button) {
      return button;
    }
  }

  return findClaudeSendButtonByComposerLayout(composer, container);
}

function findClaudeUserSubmitButtons(context: {
  findComposer: () => HTMLElement | null;
  findSendButton: () => HTMLElement | null;
}): HTMLElement[] {
  const composer = context.findComposer();
  const sendButton = context.findSendButton();
  const container = findClaudeComposerRoot(composer);
  const buttons = [
    sendButton,
    ...Array.from(
      container instanceof Element || container instanceof Document
        ? container.querySelectorAll<HTMLElement>('button')
        : [],
    ).filter(isClaudeDictationSubmitButton),
  ].filter((button): button is HTMLElement => Boolean(button));

  return buttons.filter((button, index) => buttons.indexOf(button) === index);
}

function getClaudeUserMessageTexts(): string[] {
  const headingTexts = Array.from(document.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'))
    .filter(isVisible)
    .map(getElementAccessibleText)
    .filter((text) => /^you said:/i.test(text))
    .map((text) => text.replace(/^you said:\s*/i, ''))
    .filter((text) => text.length > 0);

  if (headingTexts.length > 0) {
    return headingTexts;
  }

  const messageTexts = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-testid*="user-message" i], [data-testid*="human-message" i], [data-testid*="message-user" i]',
    ),
  )
    .filter(isVisible)
    .map(getElementTreeAccessibleText)
    .filter(Boolean);

  return messageTexts;
}

function getClaudeFileThumbnailItems(container: ParentNode): string[] {
  return getClaudeAttachmentItems(container);
}

function getClaudePastedTextAttachmentItems(container: ParentNode): string[] {
  if (!(container instanceof Element || container instanceof Document)) {
    return [];
  }

  const thumbnailItems = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="file-thumbnail"]'))
    .filter(isVisible)
    .map(getElementTreeAccessibleText)
    .filter((text) => compactAttachmentText(text).includes('pasted'));

  if (thumbnailItems.length > 0) {
    return thumbnailItems;
  }

  return Array.from(container.querySelectorAll<HTMLElement>('button[aria-label^="Remove Pasted Text" i]'))
    .filter(isVisible)
    .map(getElementAccessibleText)
    .filter(Boolean);
}

function hasCapturedPastedTextAttachment(attachments: CapturedAttachment[]): boolean {
  return attachments.some((attachment) => attachment.source === 'pasted-text');
}

export const claudeAdapter = createDomProviderAdapter({
  provider: 'claude',
  uploadCapability: PROVIDER_UPLOAD_CAPABILITIES.claude,
  pastedTextAttachmentMinChars: CLAUDE_PASTED_TEXT_ATTACHMENT_MIN_CHARS,
  mountId: 'ask-em-claude-ui',
  className: 'ask-em-provider-ui ask-em-provider-ui-claude',
  isPrivateMode() {
    return isClaudePrivateModePage(window.location.href);
  },
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
  findUserSubmitButtons: findClaudeUserSubmitButtons,
  isUserSubmitButtonEnabled: isClaudeUserSubmitButtonEnabled,
  getUserMessageTexts: getClaudeUserMessageTexts,
  isErrorPage() {
    return detectHardErrorPage({
      pageKeywords: ['conversation not found'],
      surfaceKeywords: [
        'This conversation could not be found',
        'conversation not found',
        'something went wrong',
        'service is temporarily busy',
        'service temporarily busy',
        'temporarily busy',
        'capacity',
        '找不到对话',
        '对话不存在',
        '出了点问题',
        '出现错误',
        '服务繁忙',
        '服务暂时繁忙',
        '容量不足',
      ],
    });
  },
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
    if (hasCapturedPastedTextAttachment(capturedAttachments)) {
      const pastedTextItems = getClaudePastedTextAttachmentItems(container);
      const nonPastedTextAttachments = capturedAttachments.filter(
        (attachment) => attachment.source !== 'pasted-text',
      );
      const expectedNonPastedTextKeys = nonPastedTextAttachments.length > 0
        ? getClaudeAttachmentItems(container, nonPastedTextAttachments)
        : [];

      if (pastedTextItems.length > 0 && expectedNonPastedTextKeys.length > 0) {
        return {
          count: pastedTextItems.length + expectedNonPastedTextKeys.length,
          items: [...expectedNonPastedTextKeys, ...pastedTextItems],
        };
      }

      if (pastedTextItems.length > 0 && nonPastedTextAttachments.length === 0) {
        return {
          count: pastedTextItems.length,
          items: pastedTextItems,
        };
      }
    }

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
    return detectClaudeUploadErrorText();
  },
});
