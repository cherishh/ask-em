import type { DeliverPromptMessage, Provider, ProviderStatus } from '../runtime/protocol';
import {
  detectObviousErrorPage,
  detectLoginRequired,
  dispatchEnterKey,
  getEditableText,
  isElementWithin,
  queryVisible,
  setEditableText,
  sleep,
  triggerPointerClick,
  waitFor,
  waitForUrlChange,
} from './dom';
import { getSiteInfoByProvider } from './sites';
import type { AdapterSnapshot, ProviderAdapter } from './types';

type DomProviderAdapterConfig = {
  provider: Provider;
  mountId: string;
  className: string;
  prepareDom?: () => void;
  isLoginRequired?: () => boolean;
  composerSelectors: string[];
  sendButtonSelectors?: string[];
  findSendButton?: (findComposer: () => HTMLElement | null) => HTMLElement | null;
  loginKeywords: string[];
  errorKeywords?: string[];
  submitWaitMs?: number;
  submitTimeoutMs?: number;
  isSendButtonEnabled?: (button: HTMLElement) => boolean;
};

export function createDomProviderAdapter(config: DomProviderAdapterConfig): ProviderAdapter {
  const site = getSiteInfoByProvider(config.provider);

  const prepareDom = () => {
    config.prepareDom?.();
  };
  const findComposer = () => {
    prepareDom();
    return queryVisible(config.composerSelectors);
  };
  const findSendButton = () => {
    prepareDom();
    return config.findSendButton ? config.findSendButton(findComposer) : queryVisible(config.sendButtonSelectors ?? []);
  };
  const isSendButtonEnabled = (button: HTMLElement) =>
    config.isSendButtonEnabled ? config.isSendButtonEnabled(button) : !button.hasAttribute('disabled');

  const getStatus = (): ProviderStatus => {
    prepareDom();
    const currentUrl = window.location.href;
    const isLoginRequired = config.isLoginRequired
      ? config.isLoginRequired()
      : detectLoginRequired(config.loginKeywords);
    const hasObviousError = detectObviousErrorPage(config.errorKeywords ?? []);
    const isReady = Boolean(findComposer()) && !hasObviousError;
    const pageState = isLoginRequired ? 'login-required' : isReady ? 'ready' : 'not-ready';

    return {
      provider: config.provider,
      currentUrl,
      sessionId: site.extractSessionId(currentUrl),
      pageKind: site.isBlankChatUrl(currentUrl) ? 'new-chat' : 'existing-session',
      pageState,
    };
  };

  const canDeliverPrompt = (message: DeliverPromptMessage, snapshot: AdapterSnapshot): boolean => {
    if (message.provider !== config.provider || snapshot.pageState !== 'ready') {
      return false;
    }

    if (message.expectedSessionId) {
      return snapshot.sessionId === message.expectedSessionId;
    }

    return snapshot.pageKind === 'new-chat';
  };

  return {
    name: config.provider,
    getUiSpec() {
      return {
        mountId: config.mountId,
        className: config.className,
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
        prepareDom();
        setEditableText(findComposer(), content);
      },
      async submit() {
        prepareDom();
        await sleep(config.submitWaitMs ?? 150);
        const sendButton = await waitFor(() => {
          const button = findSendButton();
          return button && isSendButtonEnabled(button) ? button : null;
        }, config.submitTimeoutMs ?? 2_000);

        if (sendButton && isSendButtonEnabled(sendButton)) {
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
}
