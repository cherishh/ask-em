import { getSiteInfoByProvider } from './sites';
import type { AdapterSnapshot, SiteAdapter } from './types';
import type { DeliverPromptMessage, PageKind, ProviderStatus } from '../runtime/protocol';
import {
  detectLoginRequired,
  dispatchEnterKey,
  findClickableByText,
  getEditableText,
  isElementWithin,
  queryVisible,
  sleep,
  setEditableText,
  triggerPointerClick,
  waitFor,
  waitForUrlChange,
} from './dom';

const site = getSiteInfoByProvider('claude');

function findComposer(): HTMLElement | null {
  return queryVisible(['[data-testid="chat-input"]', '[aria-label="Write your prompt to Claude"]']);
}

function findSendButton(): HTMLElement | null {
  return queryVisible(['button[aria-label="Send message"]']);
}

function findNewChatButton(): HTMLElement | null {
  return queryVisible(['a[aria-label="New chat"]']) ?? findClickableByText('New chat');
}

function getStatus(): ProviderStatus {
  const currentUrl = window.location.href;
  const isReady = Boolean(findComposer());
  const pageState = isReady
    ? 'ready'
    : detectLoginRequired(['log in', 'sign in', 'continue with google'])
      ? 'login-required'
      : 'not-ready';

  return {
    provider: 'claude',
    currentUrl,
    sessionId: site.extractSessionId(currentUrl),
    pageKind: site.isBlankChatUrl(currentUrl) ? 'new-chat' : 'existing-session',
    pageState,
    mounted: true,
  };
}

function canDeliverPrompt(message: DeliverPromptMessage, snapshot: AdapterSnapshot): boolean {
  if (message.provider !== 'claude' || snapshot.pageState !== 'ready') {
    return false;
  }

  if (message.expectedSessionId) {
    return snapshot.sessionId === message.expectedSessionId;
  }

  return snapshot.pageKind === 'new-chat';
}

export const claudeAdapter: SiteAdapter = {
  name: 'claude',
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
      mountId: 'ask-em-claude-ui',
      className: 'ask-em-provider-ui ask-em-provider-ui-claude',
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
    await sleep(150);
    const sendButton = await waitFor(() => {
      const button = findSendButton();
      return button && !button.hasAttribute('disabled') ? button : null;
    }, 2_000);

    if (sendButton) {
      triggerPointerClick(sendButton);
      return;
    }

    const composer = findComposer();
    if (composer) {
      dispatchEnterKey(composer);
    }
  },
  async openNewChat() {
    const newChatButton = findNewChatButton();
    if (newChatButton) {
      newChatButton.click();
      return;
    }

    window.location.href = `${site.origin}/new`;
  },
  waitForSessionRefUpdate(baselineUrl) {
    return waitForUrlChange(site.extractSessionId, baselineUrl);
  },
  canDeliverPrompt,
};
