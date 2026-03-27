import type { SiteAdapter } from './types';
import { SUPPORTED_SITES, getSiteInfo, isSupportedOrigin } from './sites';
import type { DeliverPromptMessage, PageKind, ProviderStatus } from '../runtime/protocol';

function createBaseAdapter(provider: (typeof SUPPORTED_SITES)[number]): SiteAdapter {
  return {
    name: provider.name,
    matches: provider.matches,
    getCurrentUrl() {
      return window.location.href;
    },
    extractSessionId(url) {
      return provider.extractSessionId(url);
    },
    isBlankChatUrl(url) {
      return provider.isBlankChatUrl(url);
    },
    detectPageState() {
      if (!document.body) {
        return 'not-ready';
      }

      return 'ready';
    },
    getPageKind(url) {
      const currentUrl = url ?? window.location.href;
      const kind: PageKind = provider.isBlankChatUrl(currentUrl)
        ? 'new-chat'
        : 'existing-session';
      return kind;
    },
    getStatus() {
      const currentUrl = window.location.href;
      const sessionId = provider.extractSessionId(currentUrl);
      const pageState = this.detectPageState();

      const status: ProviderStatus = {
        provider: provider.name,
        currentUrl,
        sessionId,
        pageKind: this.getPageKind(currentUrl),
        pageState,
        mounted: true,
      };

      return status;
    },
    getUiSpec() {
      return {
        tone: 'minimal',
        mountId: `ask-em-${provider.name}-ui`,
        className: 'ask-em-provider-ui',
      };
    },
    canDeliverPrompt(message: DeliverPromptMessage, snapshot) {
      if (message.provider !== provider.name) {
        return false;
      }

      if (snapshot.pageState !== 'ready') {
        return false;
      }

      if (message.expectedSessionId && snapshot.sessionId) {
        return message.expectedSessionId === snapshot.sessionId;
      }

      if (!message.expectedSessionId) {
        return snapshot.pageKind === 'new-chat';
      }

      return false;
    },
  };
}

export const adapterRegistry: Record<(typeof SUPPORTED_SITES)[number]['name'], SiteAdapter> =
  Object.fromEntries(
    SUPPORTED_SITES.map((site) => [site.name, createBaseAdapter(site)]),
  ) as Record<(typeof SUPPORTED_SITES)[number]['name'], SiteAdapter>;

export function getAdapter(provider: (typeof SUPPORTED_SITES)[number]['name']): SiteAdapter {
  return adapterRegistry[provider];
}

export function getAdapterForUrl(url: string): SiteAdapter | null {
  const siteInfo = getSiteInfo(url);
  return siteInfo ? adapterRegistry[siteInfo.name] : null;
}

export function isKnownProviderUrl(url: string): boolean {
  return isSupportedOrigin(url);
}
