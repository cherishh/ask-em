export function isVisible(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
}

export function queryVisible(selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const element = document.querySelector(selector);

    if (isVisible(element)) {
      return element;
    }
  }

  return null;
}

export function findClickableByText(text: string): HTMLElement | null {
  const normalized = normalizeWhitespace(text).toLowerCase();
  const elements = Array.from(document.querySelectorAll<HTMLElement>('a, button, [role="button"]'));

  return (
    elements.find((element) => {
      if (!isVisible(element) || shouldIgnoreDetectionSubtree(element)) {
        return false;
      }

      const candidate = normalizeWhitespace(
        element.getAttribute('aria-label') || element.innerText || element.textContent || '',
      ).toLowerCase();

      return candidate === normalized || candidate.startsWith(`${normalized} `);
    }) ?? null
  );
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function getVisibleText(element: HTMLElement): string {
  return normalizeWhitespace(element.innerText || element.textContent || '');
}

function isInIgnoredDetectionSubtree(element: Element): boolean {
  return element.closest("[id^='ask-em-'], .ask-em-sync-shell") !== null;
}

function shouldIgnoreDetectionSubtree(element: Element): boolean {
  const tagName = element.tagName;
  if (tagName === 'SCRIPT' || tagName === 'STYLE' || tagName === 'NOSCRIPT') {
    return true;
  }

  return isInIgnoredDetectionSubtree(element);
}

function getDocumentTextForDetection(): string {
  const root = document.body;
  if (!root) {
    return '';
  }

  const parts: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node instanceof Element && shouldIgnoreDetectionSubtree(node)) {
        return NodeFilter.FILTER_REJECT;
      }

      if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentElement;
        if (!parent || !isVisible(parent) || shouldIgnoreDetectionSubtree(parent)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }

      return NodeFilter.FILTER_SKIP;
    },
  });

  let current = walker.nextNode();
  while (current) {
    if (current.nodeType === Node.TEXT_NODE && current.textContent) {
      parts.push(current.textContent);
    }
    current = walker.nextNode();
  }

  return normalizeWhitespace(parts.join(' '));
}

export function getVisibleButtonTexts(): string[] {
  const elements = Array.from(document.querySelectorAll<HTMLElement>('a, button, [role="button"]'));

  return elements
    .filter((element) => isVisible(element) && !shouldIgnoreDetectionSubtree(element))
    .map((element) => getVisibleText(element))
    .filter(Boolean);
}

export function getVisibleHeadingTexts(): string[] {
  const elements = Array.from(document.querySelectorAll<HTMLElement>('h1, h2, h3'));

  return elements
    .filter((element) => isVisible(element) && !shouldIgnoreDetectionSubtree(element))
    .map((element) => getVisibleText(element))
    .filter(Boolean);
}

export type VisibleInputDescriptor = {
  tagName: string;
  type: string | null;
  placeholder: string | null;
  ariaLabel: string | null;
  name: string | null;
};

export function getVisibleInputDescriptors(): VisibleInputDescriptor[] {
  const elements = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'));

  return elements
    .filter((element) => isVisible(element) && !shouldIgnoreDetectionSubtree(element))
    .map((element) => ({
      tagName: element.tagName,
      type: element.getAttribute('type'),
      placeholder: element.getAttribute('placeholder'),
      ariaLabel: element.getAttribute('aria-label'),
      name: element.getAttribute('name'),
    }));
}

export function getEditableText(element: HTMLElement | null): string {
  if (!element) {
    return '';
  }

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value;
  }

  return normalizeWhitespace(element.innerText || element.textContent || '');
}

export function setEditableText(element: HTMLElement | null, content: string): void {
  if (!element) {
    throw new Error('Composer element not found');
  }

  element.focus();

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    const prototype = Object.getPrototypeOf(element) as HTMLTextAreaElement;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    descriptor?.set?.call(element, content);
    dispatchInputEvents(element);
    return;
  }

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection?.removeAllRanges();
  selection?.addRange(range);

  if (typeof document.execCommand === 'function') {
    document.execCommand('selectAll', false);
    const inserted = document.execCommand('insertText', false, content);

    if (inserted) {
      dispatchInputEvents(element, content);
      return;
    }
  }

  element.textContent = '';
  const lines = content.split('\n');

  if (element.classList.contains('ProseMirror') || element.classList.contains('ql-editor')) {
    for (const line of lines) {
      const paragraph = document.createElement('p');
      paragraph.textContent = line || '';
      element.appendChild(paragraph);
    }
  } else {
    element.textContent = content;
  }

  dispatchInputEvents(element, content);
}

export function dispatchInputEvents(element: HTMLElement, data: string | null = null): void {
  element.dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data,
    }),
  );
  element.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data,
    }),
  );
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

export function dispatchEnterKey(element: HTMLElement): void {
  element.focus();

  const keyboardEventInit: KeyboardEventInit = {
    key: 'Enter',
    code: 'Enter',
    which: 13,
    keyCode: 13,
    bubbles: true,
    cancelable: true,
  };

  element.dispatchEvent(new KeyboardEvent('keydown', keyboardEventInit));
  element.dispatchEvent(new KeyboardEvent('keypress', keyboardEventInit));
  element.dispatchEvent(new KeyboardEvent('keyup', keyboardEventInit));
}

export function waitForUrlChange(
  extractSessionId: (url: string) => string | null,
  baselineUrl: string,
  timeoutMs = 20_000,
): Promise<{ sessionId: string | null; url: string }> {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const timer = window.setInterval(() => {
      const url = window.location.href;
      const sessionId = extractSessionId(url);

      if (url !== baselineUrl && sessionId) {
        window.clearInterval(timer);
        resolve({ sessionId, url });
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        window.clearInterval(timer);
        reject(new Error('Timed out waiting for session ref update'));
      }
    }, 300);
  });
}

export function isElementWithin(target: EventTarget | null, container: HTMLElement | null): boolean {
  return target instanceof Node && Boolean(container?.contains(target));
}

export function detectLoginRequired(keywords: string[]): boolean {
  const bodyText = getDocumentTextForDetection().toLowerCase();
  return keywords.some((keyword) => bodyText.includes(keyword.toLowerCase()));
}

export function detectObviousErrorPage(keywords: string[] = []): boolean {
  const bodyText = getDocumentTextForDetection().toLowerCase();
  const titleText = normalizeWhitespace(document.title || '').toLowerCase();
  const combinedText = `${titleText} ${bodyText}`;

  const defaultKeywords = [
    '404',
    'not found',
    'page not found',
    'something went wrong',
    'an error occurred',
    'try again later',
    'temporarily unavailable',
    'service unavailable',
    'this page isn’t working',
    "this page isn't working",
  ];

  return [...defaultKeywords, ...keywords].some((keyword) =>
    combinedText.includes(keyword.toLowerCase()),
  );
}

type HardErrorPageOptions = {
  pageKeywords?: string[];
  surfaceKeywords?: string[];
  surfaceSelectors?: string[];
};

const DEFAULT_HARD_PAGE_KEYWORDS = [
  '404',
  'not found',
  'page not found',
  'http error',
  'this page isn’t working',
  "this page isn't working",
  'this site can’t be reached',
  "this site can't be reached",
  'aw, snap',
  'err_',
  'service unavailable',
  '页面未找到',
  '找不到页面',
  '找不到网页',
  '找不到此页面',
  '网页无法打开',
  '此网页无法正常运作',
  '服务不可用',
  '服务暂时不可用',
];

const DEFAULT_ERROR_SURFACE_SELECTORS = [
  '[role="alert"]',
  '[role="alertdialog"]',
  '[role="dialog"]',
  '[aria-live]',
  '[aria-modal="true"]',
  '[data-testid*="error" i]',
  '[data-test-id*="error" i]',
  '[class*="error" i]',
  '[class*="toast" i]',
  '[class*="snackbar" i]',
  '[class*="notification" i]',
  '[class*="banner" i]',
];

function textIncludesAny(text: string, keywords: string[]): boolean {
  const normalized = normalizeWhitespace(text).toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

function getElementDetectionText(element: HTMLElement): string {
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

function isLikelyChatContent(element: HTMLElement): boolean {
  return Boolean(
    element.closest(
      [
        'table',
        'pre',
        'code',
        'textarea',
        'input',
        '[contenteditable="true"]',
        '[data-message-author-role]',
        '[data-testid*="conversation" i]',
        '[data-testid*="message" i]',
        '[class*="markdown" i]',
        '[class*="prose" i]',
      ].join(', '),
    ),
  );
}

function getVisibleHeadingDetectionText(): string {
  return Array.from(document.querySelectorAll<HTMLElement>('h1, h2, [role="heading"]'))
    .filter((element) => isVisible(element) && !shouldIgnoreDetectionSubtree(element))
    .map(getElementDetectionText)
    .filter(Boolean)
    .join(' ');
}

export function detectHardErrorPage(options: HardErrorPageOptions = {}): boolean {
  const pageKeywords = [...DEFAULT_HARD_PAGE_KEYWORDS, ...(options.pageKeywords ?? [])];
  if (textIncludesAny(getVisibleHeadingDetectionText(), pageKeywords)) {
    return true;
  }

  const surfaceKeywords = [...pageKeywords, ...(options.surfaceKeywords ?? [])];
  const selectors = [...DEFAULT_ERROR_SURFACE_SELECTORS, ...(options.surfaceSelectors ?? [])];
  const surfaces = selectors
    .flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)))
    .filter((element, index, elements) => elements.indexOf(element) === index)
    .filter((element) =>
      isVisible(element) &&
      !shouldIgnoreDetectionSubtree(element) &&
      !isLikelyChatContent(element)
    );

  return surfaces.some((element) => textIncludesAny(getElementDetectionText(element), surfaceKeywords));
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor<T>(
  getter: () => T | null | undefined,
  timeoutMs = 4_000,
  intervalMs = 100,
): Promise<T | null> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const result = getter();
    if (result) {
      return result;
    }

    await sleep(intervalMs);
  }

  return null;
}

export function triggerPointerClick(element: HTMLElement): void {
  element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}
