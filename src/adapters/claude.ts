import { getSiteInfoByProvider } from './sites';
import type { AdapterSnapshot, ProviderAdapter } from './types';
import type { DeliverPromptMessage, ProviderStatus } from '../runtime/protocol';
import {
  detectObviousErrorPage,
  detectLoginRequired,
  dispatchEnterKey,
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

function getStatus(): ProviderStatus {
  const currentUrl = window.location.href;
  const hasObviousError = detectObviousErrorPage([
    'conversation not found',
    'something went wrong',
  ]);
  const isReady = Boolean(findComposer()) && !hasObviousError;
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

export const claudeAdapter: ProviderAdapter = {
  name: 'claude',
  getUiSpec() {
    return {
      mountId: 'ask-em-claude-ui',
      className: 'ask-em-provider-ui ask-em-provider-ui-claude',
    };
  },
  session: {
    getCurrentUrl() {
      return window.location.href;
    },
    getStatus,
    waitForSessionRefUpdate(baselineUrl) {
      return waitForUrlChange(site.extractSessionId, baselineUrl);
    },
    canDeliverPrompt,
  },
  composer: {
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
  },
};
