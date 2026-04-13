import type {
  HeartbeatMessage,
  HelloMessage,
  ProviderStatus,
  RuntimeMessage,
  UserSubmitMessage,
} from '../runtime/protocol';
import type { ProviderAdapter } from '../adapters/types';

export function buildHelloMessage(adapter: ProviderAdapter): HelloMessage {
  const status = adapter.session.getStatus();

  return {
    type: 'HELLO',
    provider: status.provider,
    currentUrl: status.currentUrl,
    sessionId: status.sessionId,
    pageState: status.pageState,
    pageKind: status.pageKind,
  };
}

export function buildHeartbeatMessage(adapter: ProviderAdapter): HeartbeatMessage {
  const status = adapter.session.getStatus();

  return {
    type: 'HEARTBEAT',
    provider: status.provider,
    currentUrl: status.currentUrl,
    sessionId: status.sessionId,
    pageState: status.pageState,
    pageKind: status.pageKind,
    timestamp: Date.now(),
  };
}

export function buildUserSubmitMessage(
  status: ProviderStatus,
  content: string,
  allowNewSetCreation: boolean,
): UserSubmitMessage {
  return {
    type: 'USER_SUBMIT',
    provider: status.provider,
    currentUrl: status.currentUrl,
    sessionId: status.sessionId,
    pageKind: status.pageKind,
    allowNewSetCreation,
    content,
    timestamp: Date.now(),
  };
}

export async function sendRuntimeMessage<T = unknown>(
  message: RuntimeMessage,
  options?: {
    onError?: (error: unknown) => void;
  },
): Promise<T | null> {
  try {
    return (await chrome.runtime.sendMessage(message)) as T;
  } catch (error) {
    options?.onError?.(error);
    return null;
  }
}

export function observeUrlChanges(onChange: () => void): () => void {
  let currentUrl = window.location.href;

  const check = () => {
    if (window.location.href !== currentUrl) {
      currentUrl = window.location.href;
      onChange();
    }
  };

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function pushState(...args) {
    const result = originalPushState.apply(this, args);
    check();
    return result;
  };

  history.replaceState = function replaceState(...args) {
    const result = originalReplaceState.apply(this, args);
    check();
    return result;
  };

  const intervalId = window.setInterval(check, 1_000);
  window.addEventListener('popstate', check);
  window.addEventListener('hashchange', check);

  return () => {
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
    window.clearInterval(intervalId);
    window.removeEventListener('popstate', check);
    window.removeEventListener('hashchange', check);
  };
}
