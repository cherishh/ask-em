import type { ProviderAdapter } from '../adapters/types';
import {
  buildHeartbeatMessage,
  buildHelloMessage,
  observeUrlChanges,
  sendRuntimeMessage,
} from './content-routing';
import type { ContentStateController, PresenceResponse } from './content-state';

const STARTUP_PRESENCE_POLL_MS = 1_000;
const STARTUP_PRESENCE_DURATION_MS = 10_000;

type PresenceKind = 'HELLO' | 'HEARTBEAT';

export function createPresenceController(
  adapter: ProviderAdapter,
  state: ContentStateController,
) {
  let startupPresenceInterval: number | null = null;
  let startupPresenceDeadline = 0;
  let stopObservingUrl: (() => void) | null = null;
  let heartbeatInterval: number | null = null;
  let focusHandler: (() => void) | null = null;
  let visibilityHandler: (() => void) | null = null;

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

  const reportPresence = async (kind: PresenceKind) => {
    const status = adapter.session.getStatus();
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
      if (!shouldContinueStartupPresencePolling()) {
        stopStartupPresencePolling();
        return;
      }

      void reportPresence('HEARTBEAT');
    }, STARTUP_PRESENCE_POLL_MS);
  };

  const start = () => {
    startStartupPresencePolling();
    stopObservingUrl = observeUrlChanges(() => {
      void reportPresence('HEARTBEAT');
    });

    heartbeatInterval = window.setInterval(() => {
      void reportPresence('HEARTBEAT');
    }, 15_000);

    focusHandler = () => {
      void reportPresence('HEARTBEAT');
    };
    window.addEventListener('focus', focusHandler);

    visibilityHandler = () => {
      void reportPresence('HEARTBEAT');
    };
    document.addEventListener('visibilitychange', visibilityHandler);

    void reportPresence('HELLO');
  };

  const destroy = () => {
    stopObservingUrl?.();
    stopObservingUrl = null;
    stopStartupPresencePolling();
    if (heartbeatInterval !== null) {
      window.clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
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
