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

const site = getSiteInfoByProvider('gemini');

function findComposer(): HTMLElement | null {
  return queryVisible(['.ql-editor[role="textbox"]', '[aria-label="Enter a prompt for Gemini"]']);
}

function findSendButton(): HTMLElement | null {
  return queryVisible(['button.send-button[aria-label="Send message"]']);
}

function getStatus(): ProviderStatus {
  const currentUrl = window.location.href;
  const hasObviousError = detectObviousErrorPage([
    'something went wrong',
    'try again in a bit',
  ]);
  const isReady = Boolean(findComposer()) && !hasObviousError;
  const pageState = isReady
    ? 'ready'
    : detectLoginRequired(['sign in', 'log in', 'google account'])
      ? 'login-required'
      : 'not-ready';

  return {
    provider: 'gemini',
    currentUrl,
    sessionId: site.extractSessionId(currentUrl),
    pageKind: site.isBlankChatUrl(currentUrl) ? 'new-chat' : 'existing-session',
    pageState,
  };
}

function canDeliverPrompt(message: DeliverPromptMessage, snapshot: AdapterSnapshot): boolean {
  if (message.provider !== 'gemini' || snapshot.pageState !== 'ready') {
    return false;
  }

  if (message.expectedSessionId) {
    return snapshot.sessionId === message.expectedSessionId;
  }

  return snapshot.pageKind === 'new-chat';
}

export const geminiAdapter: ProviderAdapter = {
  name: 'gemini',
  getUiSpec() {
    return {
      mountId: 'ask-em-gemini-ui',
      className: 'ask-em-provider-ui ask-em-provider-ui-gemini',
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
