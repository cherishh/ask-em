import { getSiteInfoByProvider } from './sites';
import type { AdapterSnapshot, SiteAdapter } from './types';
import type { DeliverPromptMessage, PageKind, ProviderStatus } from '../runtime/protocol';
import {
  dispatchEnterKey,
  findClickableByText,
  getEditableText,
  isElementWithin,
  queryVisible,
  setEditableText,
  waitForUrlChange,
} from './dom';

const site = getSiteInfoByProvider('deepseek');

function findComposer(): HTMLElement | null {
  return queryVisible(['textarea[placeholder="Message DeepSeek"]']);
}

function findSendButton(): HTMLElement | null {
  const composer = findComposer();
  const container = composer?.closest('div')?.parentElement;

  if (!container) {
    return null;
  }

  const buttons = Array.from(container.querySelectorAll<HTMLElement>('div[role="button"][aria-disabled]')).filter(
    (element) => isElementWithin(element, container),
  );

  return buttons.at(-1) ?? null;
}

function findNewChatButton(): HTMLElement | null {
  return findClickableByText('New chat');
}

function getStatus(): ProviderStatus {
  const currentUrl = window.location.href;

  return {
    provider: 'deepseek',
    currentUrl,
    sessionId: site.extractSessionId(currentUrl),
    pageKind: site.isBlankChatUrl(currentUrl) ? 'new-chat' : 'existing-session',
    pageState: findComposer() || findNewChatButton() ? 'ready' : 'not-ready',
    mounted: true,
  };
}

function canDeliverPrompt(message: DeliverPromptMessage, snapshot: AdapterSnapshot): boolean {
  if (message.provider !== 'deepseek' || snapshot.pageState !== 'ready') {
    return false;
  }

  if (message.expectedSessionId) {
    return snapshot.sessionId === message.expectedSessionId;
  }

  return snapshot.pageKind === 'new-chat';
}

export const deepseekAdapter: SiteAdapter = {
  name: 'deepseek',
  matches: site.matches,
  getCurrentUrl() {
    return window.location.href;
  },
  extractSessionId(url) {
    return site.extractSessionId(url);
  },
  isBlankChatUrl(url) {
    return site.isBlankChatUrl(url);
  },
  detectPageState() {
    return getStatus().pageState;
  },
  getPageKind(url?: string): PageKind {
    const currentUrl = url ?? window.location.href;
    return site.isBlankChatUrl(currentUrl) ? 'new-chat' : 'existing-session';
  },
  getStatus,
  getUiSpec() {
    return {
      tone: 'minimal',
      mountId: 'ask-em-deepseek-ui',
      className: 'ask-em-provider-ui ask-em-provider-ui-deepseek',
    };
  },
  getComposerText() {
    return getEditableText(findComposer());
  },
  subscribeToUserSubmissions(onSubmit) {
    const handleKeydown = (event: KeyboardEvent) => {
      const composer = findComposer();
      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.isComposing &&
        isElementWithin(event.target, composer)
      ) {
        onSubmit(getEditableText(composer));
      }
    };

    const handleClick = (event: MouseEvent) => {
      const sendButton = findSendButton();
      if (isElementWithin(event.target, sendButton)) {
        onSubmit(getEditableText(findComposer()));
      }
    };

    document.addEventListener('keydown', handleKeydown, true);
    document.addEventListener('click', handleClick, true);

    return () => {
      document.removeEventListener('keydown', handleKeydown, true);
      document.removeEventListener('click', handleClick, true);
    };
  },
  async setComposerText(content) {
    setEditableText(findComposer(), content);
  },
  async submit() {
    const sendButton = findSendButton();

    if (sendButton && sendButton.getAttribute('aria-disabled') !== 'true') {
      sendButton.click();
      return;
    }

    const composer = findComposer();
    if (composer) {
      dispatchEnterKey(composer);
    }
  },
  async openNewChat() {
    findNewChatButton()?.click();
  },
  waitForSessionRefUpdate(baselineUrl) {
    return waitForUrlChange(site.extractSessionId, baselineUrl);
  },
  canDeliverPrompt,
};
