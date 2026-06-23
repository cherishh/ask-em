import type { ProviderAdapter } from '../adapters/types';
import {
  buildHeartbeatMessage,
  buildHelloMessage,
  observeUrlChanges,
  sendRuntimeMessage,
} from './routing';
import type { ContentStateController, PresenceResponse } from './state';

const STARTUP_PRESENCE_POLL_MS = 1_000;
const STARTUP_PRESENCE_DURATION_MS = 10_000;
const DOM_PRESENCE_DEBOUNCE_MS = 250;

type PresenceKind = 'HELLO' | 'HEARTBEAT';
type PresenceTrigger = 'startup' | 'url' | 'timer' | 'focus' | 'visibility' | 'dom' | 'manual';

export function createPresenceController(
  adapter: ProviderAdapter,
  state: ContentStateController,
  dependencies?: {
    logDebug?: (entry: {
      level: 'info' | 'warn' | 'error';
      message: string;
      detail?: string;
      workspaceId?: string;
    }) => Promise<void>;
  },
) {
  let startupPresenceInterval: number | null = null;
  let startupPresenceDeadline = 0;
  let stopObservingUrl: (() => void) | null = null;
  let heartbeatInterval: number | null = null;
  let domPresenceTimer: number | null = null;
  let domObserver: MutationObserver | null = null;
  let focusHandler: (() => void) | null = null;
  let visibilityHandler: (() => void) | null = null;
  let lastObservedPageState: ReturnType<ProviderAdapter['session']['getStatus']>['pageState'] | null = null;

  const stopStartupPresencePolling = () => {
    if (startupPresenceInterval !== null) {
      window.clearInterval(startupPresenceInterval);
      startupPresenceInterval = null;
    }
  };

  const shouldContinueStartupPresencePolling = () =>
    Date.now() < startupPresenceDeadline &&
    !state.getUiContext().workspaceId &&
    !state.shouldShowStandaloneIndicator();

  const isWithinStartupPresenceWindow = () =>
    Date.now() < startupPresenceDeadline &&
    !state.getUiContext().workspaceId;

  const stopDomPresenceTimer = () => {
    if (domPresenceTimer !== null) {
      window.clearTimeout(domPresenceTimer);
      domPresenceTimer = null;
    }
  };

  const reportPresence = async (kind: PresenceKind, trigger: PresenceTrigger = 'manual') => {
    const status = adapter.session.getStatus();
    const previousPageState = lastObservedPageState;
    lastObservedPageState = status.pageState;

    if (previousPageState !== null && previousPageState !== status.pageState) {
      if (status.pageState === 'login-required') {
        await dependencies?.logDebug?.({
          level: 'warn',
          message: 'Observed auth classification',
          detail: `rule=${status.authRule ?? 'unknown'}; kind=${status.pageKind}; url=${status.currentUrl}; signals=${status.authSignalSummary ?? 'none'}`,
          workspaceId: state.getUiContext().workspaceId ?? undefined,
        });
      } else {
        await dependencies?.logDebug?.({
          level: status.pageState === 'ready' ? 'info' : 'warn',
          message: 'Observed local page state change',
          detail: `${previousPageState} -> ${status.pageState} (${status.pageKind}; trigger=${trigger}) @ ${status.currentUrl}`,
          workspaceId: state.getUiContext().workspaceId ?? undefined,
        });
      }
    }

    const response =
      kind === 'HELLO'
        ? await sendRuntimeMessage<PresenceResponse>(buildHelloMessage(adapter), {
            onError(error) {
              console.warn('ask-em: failed to report content presence', error);
            },
          })
        : await sendRuntimeMessage<PresenceResponse>(buildHeartbeatMessage(adapter));

    state.applyPresenceResponse(response);
    state.applyIndicatorPresentation(status);

    if (!shouldContinueStartupPresencePolling()) {
      stopStartupPresencePolling();
    }
  };

  const startStartupPresencePolling = () => {
    stopStartupPresencePolling();

    startupPresenceDeadline = Date.now() + STARTUP_PRESENCE_DURATION_MS;
    startupPresenceInterval = window.setInterval(() => {
      if (!isWithinStartupPresenceWindow()) {
        stopStartupPresencePolling();
        return;
      }

      void reportPresence('HEARTBEAT', 'startup');
    }, STARTUP_PRESENCE_POLL_MS);
  };

  const scheduleDomPresenceCheck = () => {
    if (domPresenceTimer !== null) {
      return;
    }

    domPresenceTimer = window.setTimeout(() => {
      domPresenceTimer = null;
      const status = adapter.session.getStatus();
      if (lastObservedPageState !== null && status.pageState === lastObservedPageState) {
        return;
      }

      void reportPresence('HEARTBEAT', 'dom');
    }, DOM_PRESENCE_DEBOUNCE_MS);
  };

  const startDomPresenceObserver = () => {
    if (typeof MutationObserver === 'undefined' || !document.body) {
      return;
    }

    domObserver = new MutationObserver(scheduleDomPresenceCheck);
    domObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'data-test-id', 'data-testid', 'aria-label'],
      childList: true,
      subtree: true,
    });
  };

  const start = () => {
    startStartupPresencePolling();
    stopObservingUrl = observeUrlChanges(() => {
      void reportPresence('HEARTBEAT', 'url');
    });
    startDomPresenceObserver();

    heartbeatInterval = window.setInterval(() => {
      void reportPresence('HEARTBEAT', 'timer');
    }, 15_000);

    focusHandler = () => {
      void reportPresence('HEARTBEAT', 'focus');
    };
    window.addEventListener('focus', focusHandler);

    visibilityHandler = () => {
      void reportPresence('HEARTBEAT', 'visibility');
    };
    document.addEventListener('visibilitychange', visibilityHandler);

    void reportPresence('HELLO', 'startup');
  };

  const destroy = () => {
    stopObservingUrl?.();
    stopObservingUrl = null;
    stopStartupPresencePolling();
    if (heartbeatInterval !== null) {
      window.clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    stopDomPresenceTimer();
    domObserver?.disconnect();
    domObserver = null;
    if (focusHandler) {
      window.removeEventListener?.('focus', focusHandler);
      focusHandler = null;
    }
    if (visibilityHandler) {
      document.removeEventListener?.('visibilitychange', visibilityHandler);
      visibilityHandler = null;
    }
  };

  return {
    reportPresence,
    start,
    destroy,
  };
}

export type ContentPresenceController = ReturnType<typeof createPresenceController>;
