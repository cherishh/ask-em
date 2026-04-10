import { expect, vi } from 'vitest';
import type { DeliverPromptMessage, Provider } from '../runtime/protocol';
import type { AdapterSnapshot, SiteAdapter } from './types';

type StubPageInput = {
  url: string;
  title?: string;
  bodyText?: string;
  visibleSelectors?: string[];
};

class StubHTMLElement {
  innerText = '';
  textContent = '';
  parentElement: StubHTMLElement | null = null;
  classList = {
    contains: () => false,
  };

  private readonly attributes = new Map<string, string>();

  constructor(private readonly width = 180, private readonly height = 32) {}

  getBoundingClientRect() {
    return {
      width: this.width,
      height: this.height,
    } as DOMRect;
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string) {
    return this.attributes.has(name);
  }

  querySelectorAll() {
    return [];
  }
}

export function stubAdapterPage({
  url,
  title = '',
  bodyText = '',
  visibleSelectors = [],
}: StubPageInput) {
  const elements = new Map(
    visibleSelectors.map((selector) => [selector, new StubHTMLElement()] as const),
  );
  const body = new StubHTMLElement();
  body.innerText = bodyText;
  body.textContent = bodyText;

  vi.stubGlobal('HTMLElement', StubHTMLElement);
  vi.stubGlobal('document', {
    title,
    body,
    querySelector: vi.fn((selector: string) => elements.get(selector) ?? null),
  });
  vi.stubGlobal('window', {
    location: {
      href: url,
    },
    getComputedStyle: vi.fn(() => ({
      display: 'block',
      visibility: 'visible',
    })),
  });
}

function createDeliverPromptMessage(
  provider: Provider,
  expectedSessionId: string | null,
): DeliverPromptMessage {
  return {
    type: 'DELIVER_PROMPT',
    workspaceId: 'workspace-1',
    provider,
    content: 'Hello',
    expectedSessionId,
    expectedUrl: null,
    timestamp: 1,
  };
}

function createSnapshot(
  provider: Provider,
  overrides: Partial<AdapterSnapshot> = {},
): AdapterSnapshot {
  return {
    provider,
    currentUrl: `https://example.test/${provider}`,
    sessionId: null,
    pageState: 'ready',
    pageKind: 'new-chat',
    ...overrides,
  };
}

export function expectDeliverySessionGuard(
  adapter: SiteAdapter,
  provider: Provider,
  sessionId: string,
) {
  if (!adapter.canDeliverPrompt) {
    throw new Error(`${provider} adapter does not implement canDeliverPrompt`);
  }

  const wrongProvider: Provider = provider === 'claude' ? 'chatgpt' : 'claude';
  const existingSession = createSnapshot(provider, {
    sessionId,
    pageKind: 'existing-session',
  });

  expect(adapter.canDeliverPrompt(createDeliverPromptMessage(provider, sessionId), existingSession)).toBe(true);
  expect(
    adapter.canDeliverPrompt(
      createDeliverPromptMessage(provider, 'different-session'),
      existingSession,
    ),
  ).toBe(false);
  expect(
    adapter.canDeliverPrompt(
      createDeliverPromptMessage(provider, null),
      createSnapshot(provider, {
        sessionId: null,
        pageKind: 'new-chat',
      }),
    ),
  ).toBe(true);
  expect(
    adapter.canDeliverPrompt(
      createDeliverPromptMessage(wrongProvider, sessionId),
      existingSession,
    ),
  ).toBe(false);
  expect(
    adapter.canDeliverPrompt(
      createDeliverPromptMessage(provider, sessionId),
      createSnapshot(provider, {
        sessionId,
        pageKind: 'existing-session',
        pageState: 'not-ready',
      }),
    ),
  ).toBe(false);
}
