import {
  findClickableByText,
  detectHardErrorPage,
  getVisibleButtonTexts,
  isVisible,
  normalizeWhitespace,
  triggerPointerClick,
  waitFor,
} from './dom';
import { createDomProviderAdapter } from './factory';
import { readAttachmentFiles, setNextTransientFileInputFiles } from './attachment-delivery';
import { PROVIDER_UPLOAD_CAPABILITIES } from '../runtime/protocol';

function dismissManusOverlay(): void {
  const gotIt = findClickableByText('I got it') ?? findClickableByText('Got it');
  if (gotIt) {
    triggerPointerClick(gotIt);
    return;
  }

  const closeButton = Array.from(document.querySelectorAll<HTMLElement>('div')).find((element) => {
    if (!isVisible(element)) {
      return false;
    }

    const className = typeof element.className === 'string' ? element.className : '';
    return (
      className.includes('cursor-pointer') &&
      className.includes('rounded-full') &&
      Boolean(element.querySelector('svg.lucide-x'))
    );
  });

  if (closeButton) {
    triggerPointerClick(closeButton);
  }
}

export function isManusLoginRequiredPage(input: {
  pathname: string;
  buttonTexts: string[];
}): boolean {
  const pathname = input.pathname.toLowerCase();
  const buttonTexts = input.buttonTexts.map((text) => text.toLowerCase());
  const authCtaCount = buttonTexts.filter(
    (text) => text === 'sign in' || text === 'sign up' || text.startsWith('continue with '),
  ).length;

  if (pathname.startsWith('/login')) {
    return true;
  }

  if (pathname === '/' || pathname === '') {
    return authCtaCount > 0;
  }

  return authCtaCount >= 2;
}

function findManusComposerRoot(composer: HTMLElement | null): ParentNode {
  return (
    composer?.closest<HTMLElement>('div[class*="rounded-"]') ??
    composer?.parentElement?.parentElement ??
    composer?.parentElement ??
    document
  );
}

function hasManusSubmittableContent(
  composer: HTMLElement | null,
  container: ParentNode,
): boolean {
  if (normalizeWhitespace(composer?.innerText || composer?.textContent || '').length > 0) {
    return true;
  }

  return getManusAttachmentPresence(container).count > 0;
}

function isManusSendButtonStyle(button: HTMLElement): boolean {
  const className = typeof button.className === 'string' ? button.className : '';
  return (
    className.includes('Button-primary-black') ||
    className.includes('bg-[var(--Button-primary-black)]') ||
    className.includes('bg-[var(--Button-black)]')
  );
}

function isManusSubmitCandidateButton(button: HTMLElement): boolean {
  if (!isVisible(button) || button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true') {
    return false;
  }

  if (button.closest("[id^='ask-em-'], .ask-em-sync-shell")) {
    return false;
  }

  const rect = button.getBoundingClientRect();
  return rect.width <= 72 && rect.height <= 72;
}

function findManusSendButtonByComposerLayout(
  composer: HTMLElement | null,
  container: ParentNode,
): HTMLElement | null {
  if (
    !composer ||
    !(container instanceof Element || container instanceof Document) ||
    !hasManusSubmittableContent(composer, container)
  ) {
    return null;
  }

  const composerRect = composer.getBoundingClientRect();
  const containerRect = container instanceof Element ? container.getBoundingClientRect() : null;
  const buttons = Array.from(container.querySelectorAll<HTMLElement>('button'))
    .filter(isManusSubmitCandidateButton)
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
      element.innerText || element.textContent,
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function getManusAttachmentCardKey(element: HTMLElement): string {
  return normalizeWhitespace(
    [
      getElementAccessibleText(element),
      ...Array.from(element.querySelectorAll<HTMLImageElement>('img[alt]'))
        .map((image) => image.alt),
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function getManusAttachmentCards(container: ParentNode): HTMLElement[] {
  if (!(container instanceof Element || container instanceof Document)) {
    return [];
  }

  return Array.from(container.querySelectorAll<HTMLElement>('[class*="group/attach"]'))
    .filter(isVisible)
    .filter((element, index, elements) => elements.indexOf(element) === index);
}

function getManusAggregateAttachmentCount(
  container: ParentNode,
  attachmentCards: HTMLElement[],
): number {
  if (!(container instanceof Element || container instanceof Document)) {
    return 0;
  }

  const attachmentContainers = new Set<HTMLElement>(
    attachmentCards
      .map((card) => card.parentElement)
      .filter((element): element is HTMLElement => Boolean(element)),
  );

  // Manus also has unrelated +N controls for integrations; only count +N beside attachment cards.
  return Array.from(container.querySelectorAll<HTMLElement>('button, [role="button"], div[aria-haspopup="dialog"]'))
    .filter(isVisible)
    .filter((element) =>
      Array.from(attachmentContainers).some((attachmentContainer) =>
        attachmentContainer.contains(element),
      ),
    )
    .map(getElementAccessibleText)
    .map((text) => text.match(/^\+(\d+)$/)?.[1])
    .filter((value): value is string => Boolean(value))
    .reduce((total, value) => total + Number(value), 0);
}

function getManusAttachmentPresence(container: ParentNode): { count: number; items?: string[] } {
  const cards = getManusAttachmentCards(container);
  const visibleItems = cards.map(getManusAttachmentCardKey).filter(Boolean);
  const count = cards.length + getManusAggregateAttachmentCount(container, cards);

  return {
    count,
    items: visibleItems.length === count ? visibleItems : undefined,
  };
}

function findManusUploadLimitDialog(): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"]'))
    .filter(isVisible)
    .find((element) => {
      const text = getElementAccessibleText(element).toLowerCase();
      return text.includes('up to 1 file') || text.includes('unlimited uploads');
    }) ?? null;
}

function findClickableWithin(container: HTMLElement, text: string): HTMLElement | null {
  const normalized = normalizeWhitespace(text).toLowerCase();

  return Array.from(container.querySelectorAll<HTMLElement>('button, [role="button"], [class*="cursor-pointer"]'))
    .filter(isVisible)
    .find((element) => getElementAccessibleText(element).toLowerCase() === normalized) ?? null;
}

function dismissManusUploadLimitDialog(): boolean {
  const dialog = findManusUploadLimitDialog();
  if (!dialog) {
    return false;
  }

  const cancelButton = findClickableWithin(dialog, 'Cancel');
  if (cancelButton) {
    triggerPointerClick(cancelButton);
    return true;
  }

  const closeButton = Array.from(dialog.querySelectorAll<HTMLElement>('[class*="cursor-pointer"]'))
    .filter(isVisible)
    .find((element) => element.querySelector('svg.lucide-x'));
  if (closeButton) {
    triggerPointerClick(closeButton);
    return true;
  }

  return false;
}

function findManusNewTaskButton(): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], [class*="clickable"]'))
    .filter(isVisible)
    .find((element) => Boolean(element.querySelector('svg.lucide-square-pen'))) ?? null;
}

async function prepareManusBlankDeliverySurface(input: {
  expectedSessionId: string | null;
  findComposer: () => HTMLElement | null;
}): Promise<void> {
  dismissManusUploadLimitDialog();
  const dialogClosed = await waitFor(() => findManusUploadLimitDialog() ? null : true, 1_000, 50);

  const getCurrentAttachmentCount = () => {
    const container = findManusComposerRoot(input.findComposer());
    return getManusAttachmentPresence(container).count;
  };

  if (getCurrentAttachmentCount() === 0 && dialogClosed) {
    return;
  }

  if (input.expectedSessionId) {
    throw new Error('delivery surface not clean');
  }

  if (!dialogClosed) {
    throw new Error('delivery surface not clean');
  }

  const newTaskButton = await waitFor(findManusNewTaskButton, 3_000, 100);
  if (!newTaskButton) {
    throw new Error('delivery surface not clean');
  }

  triggerPointerClick(newTaskButton);
  const isClean = await waitFor(() => {
    dismissManusUploadLimitDialog();
    return getCurrentAttachmentCount() === 0 && !findManusUploadLimitDialog() ? true : null;
  }, 5_000, 100);

  if (!isClean) {
    throw new Error('delivery surface not clean');
  }
}

function findManusToolButton(container: ParentNode): HTMLElement | null {
  if (!(container instanceof Element || container instanceof Document)) {
    return null;
  }

  return Array.from(container.querySelectorAll<HTMLElement>('button, [role="button"]'))
    .filter(isVisible)
    .find((element) => element.querySelector('svg.lucide-plus')) ?? null;
}

const MANUS_LOCAL_FILES_LABELS = new Set([
  'add from local files',
  '从本地文件添加',
  'aus lokalen dateien hinzufügen',
  'agregar desde archivos locales',
  'ajouter depuis les fichiers locaux',
  'aggiungi da file locali',
  'adicionar de arquivos locais',
  'adicionar a partir de ficheiros locais',
  'thêm từ tệp cục bộ',
  '从本机档案新增',
  '從本機檔案新增',
  'ローカルファイルから追加',
  '로컬 파일에서 추가',
  'أضف من الملفات المحلية',
]);

function findManusAddLocalFilesItem(): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], [role="menuitem"], div, span'))
    .filter(isVisible)
    .filter((element) => {
      const text = getElementAccessibleText(element).toLowerCase();
      return MANUS_LOCAL_FILES_LABELS.has(text) || Boolean(element.querySelector('svg.lucide-paperclip'));
    });

  const clickableCandidates = candidates
    .map((element) => element.closest<HTMLElement>('[role="menuitem"], button, [role="button"], [class*="cursor-pointer"]') ?? element)
    .filter((element, index, elements) => elements.indexOf(element) === index)
    .filter(isVisible);
  const candidate = clickableCandidates.find((element) => {
    const className = typeof element.className === 'string' ? element.className : '';
    return className.includes('cursor-pointer') || element.matches('button, [role="button"], [role="menuitem"]');
  }) ?? clickableCandidates.at(-1);

  return candidate ?? null;
}

async function clickManusAddLocalFiles(container: ParentNode): Promise<void> {
  let menuItem = findManusAddLocalFilesItem();
  if (!menuItem) {
    const toolButton = await waitFor(() => findManusToolButton(container), 5_000, 100);
    if (!toolButton) {
      throw new Error('upload failed');
    }

    triggerPointerClick(toolButton);
    menuItem = await waitFor(findManusAddLocalFilesItem, 2_000, 50);
  }

  if (!menuItem) {
    throw new Error('upload failed');
  }

  triggerPointerClick(menuItem);
}

function detectManusUploadErrorText(): string | null {
  // The free-plan multi-file limit is surfaced as a centered dialog, not an alert/toast.
  const errorSelectors = [
    '[role="alert"]',
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[aria-live]',
    '[aria-modal="true"]',
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
    'upload up to',
    'up to 1 file',
    'unlimited uploads',
    'error uploading',
  ];

  return uploadErrorPatterns.some((pattern) => visibleTexts.includes(pattern)) ? 'upload failed' : null;
}

export const manusAdapter = createDomProviderAdapter({
  provider: 'manus',
  // TODO: make this plan-aware if Manus exposes a reliable free/pro capability signal.
  uploadCapability: PROVIDER_UPLOAD_CAPABILITIES.manus,
  mountId: 'ask-em-manus-ui',
  className: 'ask-em-provider-ui ask-em-provider-ui-manus',
  prepareDom: dismissManusOverlay,
  classifyAuth() {
    const pathname = window.location.pathname;
    const buttonTexts = getVisibleButtonTexts();
    const isLoginRequired = isManusLoginRequiredPage({
      pathname,
      buttonTexts,
    });

    return {
      isLoginRequired,
      rule: pathname.toLowerCase().startsWith('/login')
        ? 'manus-auth-url'
        : isLoginRequired
          ? 'manus-visible-nav-auth-cta'
          : undefined,
      signals: `pathname=${pathname}; buttons=[${buttonTexts.slice(0, 8).join(' | ')}]`,
    };
  },
  composerSelectors: ['.tiptap.ProseMirror'],
  findSendButton(findComposer) {
    const composer = findComposer();
    const container = findManusComposerRoot(composer);

    if (!(container instanceof Element || container instanceof Document)) {
      return null;
    }

    const buttons = Array.from(container.querySelectorAll<HTMLElement>('button'))
      .filter(isVisible)
      .filter(isManusSendButtonStyle);

    return buttons.at(-1) ?? findManusSendButtonByComposerLayout(composer, container);
  },
  isErrorPage() {
    return detectHardErrorPage({
      surfaceKeywords: [
        'network error',
        'try again',
        'failed to load',
        'something went wrong',
        'unable to process',
        '网络错误',
        '网络异常',
        '请重试',
        '请稍后重试',
        '加载失败',
        '加载出错',
        '出了点问题',
        '出现错误',
        '无法处理',
      ],
    });
  },
  async prepareForDelivery(payload, context) {
    await prepareManusBlankDeliverySurface({
      expectedSessionId: payload.expectedSessionId,
      findComposer: context.findComposer,
    });
  },
  async setComposerPayload(payload, context) {
    await context.setComposerText(payload.text);

    if (payload.attachments.length === 0) {
      return;
    }

    const composer = context.findComposer();
    const container = findManusComposerRoot(composer);
    const files = await readAttachmentFiles(payload.attachments);

    await setNextTransientFileInputFiles(files, () => clickManusAddLocalFiles(container), {
      // Manus can accept the file and render the attachment card while the MAIN-world
      // delivery ack is lost during app route/state churn. Let the shared presence gate
      // verify the actual page state instead of blocking the provider adapter here.
      awaitDeliveryResult: false,
    });
  },
  getComposerAttachmentPresence({ findComposer }) {
    const container = findManusComposerRoot(findComposer());
    const presence = getManusAttachmentPresence(container);

    return {
      count: presence.count,
      keys: presence.items,
    };
  },
  getComposerAttachmentSnapshot({ findComposer }) {
    const container = findManusComposerRoot(findComposer());
    const presence = getManusAttachmentPresence(container);

    return {
      count: presence.count,
      items: presence.items,
    };
  },
  detectAttachmentUploadError() {
    return detectManusUploadErrorText();
  },
  submitWaitMs: 200,
  submitTimeoutMs: 3_000,
});
