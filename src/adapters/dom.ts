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
      if (!isVisible(element)) {
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

  dispatchInputEvents(element);
}

export function dispatchInputEvents(element: HTMLElement): void {
  element.dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: null,
    }),
  );
  element.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: null,
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
  timeoutMs = 15_000,
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
