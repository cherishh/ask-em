import {
  detectHardErrorPage,
  getVisibleButtonTexts,
  isElementWithin,
  isVisible,
  normalizeWhitespace,
  triggerPointerClick,
  waitFor,
} from './dom';
import { createDomProviderAdapter } from './factory';
import { readAttachmentFiles, setFileInputFiles } from './attachment-delivery';
import {
  KIMI_ATTACHMENT_FANOUT_ENABLED,
  PROVIDER_UPLOAD_CAPABILITIES,
  type AttachmentRef,
} from '../runtime/protocol';

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

  return input.buttonTexts.some((text) =>
    authLabels.has(normalizeWhitespace(text).toLowerCase()),
  );
}

function findKimiComposer(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '#chat-box .chat-input-editor[contenteditable="true"][role="textbox"], .chat-input-editor[contenteditable="true"][role="textbox"]',
  );
}

function findKimiComposerRoot(composer: HTMLElement | null): ParentNode {
  return (
    composer?.closest('#chat-box') ??
    composer?.closest('.chat-editor') ??
    document
  );
}

function findKimiSendButton(composer: HTMLElement | null): HTMLElement | null {
  const root = findKimiComposerRoot(composer);
  if (!(root instanceof Element || root instanceof Document)) {
    return null;
  }

  return (
    Array.from(
      root.querySelectorAll<HTMLElement>('.send-button-container'),
    ).find(isVisible) ?? null
  );
}

const KIMI_TOOLKIT_INPUT_TIMEOUT_MS = 2_000;

function findKimiToolkitFileInput(): HTMLInputElement | null {
  return (
    Array.from(
      document.querySelectorAll<HTMLInputElement>(
        '.toolkit-popover input[type="file"], .toolkit-item input[type="file"]',
      ),
    ).find((input) => !input.disabled) ?? null
  );
}

// Kimi only mounts its file input while the "+" toolkit popover is open; the popover
// is teleported to <body>, so it cannot be found through the composer subtree.
async function openKimiToolkitFileInput(): Promise<HTMLInputElement | null> {
  const existing = findKimiToolkitFileInput();
  if (existing) {
    return existing;
  }

  const root = findKimiComposerRoot(findKimiComposer());
  const trigger =
    root instanceof Element || root instanceof Document
      ? (Array.from(
        root.querySelectorAll<HTMLElement>('.toolkit-trigger-btn'),
      ).find(isVisible) ?? null)
      : null;
  if (!trigger) {
    return null;
  }

  triggerPointerClick(trigger);
  return waitFor(findKimiToolkitFileInput, KIMI_TOOLKIT_INPUT_TIMEOUT_MS);
}

function compactAttachmentText(value: string): string {
  return normalizeWhitespace(value).replace(/\s+/g, '').toLowerCase();
}

function getAttachmentNameStem(name: string): string {
  const lastSegment = name.trim().split(/[\\/]/).at(-1) ?? '';
  const dotIndex = lastSegment.lastIndexOf('.');

  return dotIndex > 0 ? lastSegment.slice(0, dotIndex) : lastSegment;
}

// Kimi renders documents as .file-card-container (states via class: parsing ->
// success; only success cards are submittable) and images as .image-thumbnail
// (ready = neither .loading nor .error, and no filename text anywhere). Match
// expected attachments by name stem against file cards, and by count against
// ready image thumbnails for image/* attachments.
type KimiAttachmentEntry = {
  kind: 'file' | 'image';
  text: string;
};

function getKimiReadyAttachmentEntries(): KimiAttachmentEntry[] {
  const root = document.getElementById('chat-box');
  if (!root) {
    return [];
  }

  const fileEntries = Array.from(
    root.querySelectorAll<HTMLElement>('.file-card-container'),
  )
    .filter(isVisible)
    .filter((card) => card.classList.contains('success'))
    .map((card) => ({
      kind: 'file' as const,
      text: normalizeWhitespace(card.innerText || card.textContent || ''),
    }))
    .filter((entry) => entry.text);
  const imageEntries = Array.from(
    root.querySelectorAll<HTMLElement>('.image-thumbnail'),
  )
    .filter(isVisible)
    .filter(
      (thumb) =>
        !thumb.classList.contains('loading') &&
        !thumb.classList.contains('error'),
    )
    .map(() => ({
      kind: 'image' as const,
      text: '',
    }));

  return [...fileEntries, ...imageEntries];
}

function getKimiAttachmentItems(
  expectedAttachments?: AttachmentRef[],
): string[] {
  const entries = getKimiReadyAttachmentEntries();

  if (!expectedAttachments || expectedAttachments.length === 0) {
    return entries.map((entry, index) => entry.text || `image-${index + 1}`);
  }

  const usedIndexes = new Set<number>();
  const matchedItems: string[] = [];
  for (const attachment of expectedAttachments) {
    const stem = compactAttachmentText(getAttachmentNameStem(attachment.name));
    const isImage = attachment.mime.toLowerCase().startsWith('image/');

    const matchedIndex = entries.findIndex((entry, index) => {
      if (usedIndexes.has(index)) {
        return false;
      }

      if (isImage) {
        return entry.kind === 'image';
      }

      return (
        entry.kind === 'file' &&
        stem.length > 0 &&
        compactAttachmentText(entry.text).includes(stem)
      );
    });
    if (matchedIndex >= 0) {
      usedIndexes.add(matchedIndex);
      matchedItems.push(attachment.name);
    }
  }

  return matchedItems;
}

function getKimiAttachmentDiagnostic(): string {
  const root = document.getElementById('chat-box');
  if (!root) {
    return 'kimiCards=[chat-box missing]';
  }

  const cards = Array.from(
    root.querySelectorAll<HTMLElement>('.file-card-container, .image-thumbnail'),
  )
    .filter(isVisible)
    .map((card) => {
      const kind = card.classList.contains('image-thumbnail') ? 'image' : 'file';
      const state = ['success', 'parsing', 'loading', 'error']
        .find((candidate) => card.classList.contains(candidate)) ?? 'ready';
      const text = normalizeWhitespace(card.innerText || card.textContent || '');

      return `${kind}:${state}${text ? `:${text}` : ''}`;
    });

  return `kimiCards=[${cards.join(' | ') || 'none'}]`;
}

const KIMI_UPLOAD_ERROR_PATTERNS = [
  'unsupported format',
  'upload failed',
  'failed to upload',
  'file too large',
  '不支持的格式',
  '上传失败',
  '文件过大',
];

function detectKimiUploadErrorText(): string | null {
  const hasErrorCard = Array.from(
    document.querySelectorAll<HTMLElement>(
      '#chat-box .file-card-container.error, #chat-box .image-thumbnail.error',
    ),
  ).some(isVisible);
  if (hasErrorCard) {
    return 'upload failed';
  }

  const toastTexts = Array.from(
    document.querySelectorAll<HTMLElement>(
      '.message-container, [role="alert"]',
    ),
  )
    .filter(isVisible)
    .map((element) =>
      normalizeWhitespace(
        element.innerText || element.textContent || '',
      ).toLowerCase(),
    );

  return toastTexts.some((text) =>
    KIMI_UPLOAD_ERROR_PATTERNS.some((pattern) => text.includes(pattern)),
  )
    ? 'upload failed'
    : null;
}

function setKimiComposerText(
  composer: HTMLElement | null,
  content: string,
): void {
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
  composer.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: content,
    }),
  );
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
  // Kimi intercepts file drops with a full-page mask (.drop-file-mask), so the
  // real drop target is the mask, not the composer subtree.
  isDropTargetForComposer(target, composer) {
    if (isElementWithin(target, composer)) {
      return true;
    }

    return (
      target instanceof Element &&
      Boolean(target.closest('.drop-file-mask, .drop-area, .drop-file-box'))
    );
  },
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
  async setComposerPayload(payload, context) {
    setKimiComposerText(context.findComposer(), payload.text);

    if (
      !KIMI_ATTACHMENT_FANOUT_ENABLED ||
      payload.attachments.length === 0
    ) {
      return;
    }

    const fileInput = await openKimiToolkitFileInput();
    if (!fileInput) {
      throw new Error('upload failed');
    }

    await setFileInputFiles(
      fileInput,
      await readAttachmentFiles(payload.attachments),
      { serialize: true },
    );
  },
  getComposerAttachmentPresence(_context, expectedAttachments) {
    if (!KIMI_ATTACHMENT_FANOUT_ENABLED) {
      return { count: 0, keys: [] };
    }

    const items = getKimiAttachmentItems(expectedAttachments);

    return {
      count: items.length,
      keys: items,
      diagnostic: getKimiAttachmentDiagnostic(),
    };
  },
  getComposerAttachmentSnapshot(_context, capturedAttachments) {
    const items = getKimiAttachmentItems(capturedAttachments);

    return {
      count: items.length,
      items,
    };
  },
  isFileInputForComposer(input) {
    return Boolean(
      input.type === 'file' &&
        !input.disabled &&
        input.closest('.toolkit-popover, .toolkit-item, #chat-box'),
    );
  },
  detectAttachmentUploadError() {
    return KIMI_ATTACHMENT_FANOUT_ENABLED
      ? detectKimiUploadErrorText()
      : null;
  },
  isSendButtonEnabled(button) {
    return (
      !button.classList.contains('disabled') && !button.hasAttribute('disabled')
    );
  },
});
