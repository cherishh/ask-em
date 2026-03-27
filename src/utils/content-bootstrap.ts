import type { SiteAdapter } from '../adapters/types';
import type { DeliverPromptMessage, PingMessage, PingResponseMessage, RuntimeMessage } from '../runtime/protocol';
import { buildHeartbeatMessage, buildHelloMessage, buildUserSubmitMessage, observeUrlChanges, sendRuntimeMessage } from './content-routing';

type UiState = 'idle' | 'listening' | 'syncing' | 'blocked';

function ensureUi(adapter: SiteAdapter) {
  const { mountId, className } = adapter.getUiSpec();

  if (!document.getElementById('ask-em-content-style')) {
    const style = document.createElement('style');
    style.id = 'ask-em-content-style';
    style.textContent = `
      .ask-em-sync-pill {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 28px;
        padding: 0 10px;
        border-radius: 999px;
        border: 1px solid rgba(15, 23, 42, 0.08);
        background: rgba(255, 255, 255, 0.72);
        backdrop-filter: blur(14px) saturate(1.2);
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
        color: rgba(15, 23, 42, 0.72);
        font: 500 11px/1.1 "SF Mono", "IBM Plex Mono", Menlo, Monaco, Consolas, monospace;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        opacity: 0.28;
        transform: translateY(0);
        transition: opacity 180ms ease, transform 180ms ease, border-color 180ms ease, color 180ms ease;
        pointer-events: none;
        user-select: none;
      }

      .ask-em-sync-pill:hover {
        opacity: 0.82;
      }

      .ask-em-sync-pill::before {
        content: "";
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: var(--ask-em-accent, rgba(15, 23, 42, 0.45));
        box-shadow: 0 0 0 4px color-mix(in srgb, var(--ask-em-accent, #0f172a) 12%, transparent);
      }

      .ask-em-sync-pill[data-state="idle"] {
        --ask-em-accent: rgba(100, 116, 139, 0.65);
      }

      .ask-em-sync-pill[data-state="listening"] {
        opacity: 0.58;
        --ask-em-accent: rgba(14, 116, 144, 0.72);
      }

      .ask-em-sync-pill[data-state="syncing"] {
        opacity: 0.88;
        color: rgba(15, 23, 42, 0.88);
        --ask-em-accent: rgba(37, 99, 235, 0.82);
      }

      .ask-em-sync-pill[data-state="blocked"] {
        opacity: 0.88;
        color: rgba(127, 29, 29, 0.78);
        --ask-em-accent: rgba(220, 38, 38, 0.82);
      }
    `;
    document.documentElement.appendChild(style);
  }

  let mount = document.getElementById(mountId);
  if (!mount) {
    mount = document.createElement('div');
    mount.id = mountId;
    mount.className = className;
    mount.classList.add('ask-em-sync-pill');
    mount.dataset.state = 'idle';
    mount.textContent = "ask'em";
    document.body.appendChild(mount);
  }

  return {
    setState(state: UiState, label?: string) {
      mount.dataset.state = state;
      mount.textContent = label ?? "ask'em";
    },
  };
}

export function bootstrapContentScript(adapter: SiteAdapter): void {
  const ui = ensureUi(adapter);
  let suppressSubmissionsUntil = 0;
  let lastFingerprint = '';
  let lastFingerprintAt = 0;

  const reportPresence = async (kind: 'HELLO' | 'HEARTBEAT') => {
    if (kind === 'HELLO') {
      await sendRuntimeMessage(buildHelloMessage(adapter));
      return;
    }

    await sendRuntimeMessage(buildHeartbeatMessage(adapter));
  };

  const reportUserSubmit = async (rawContent: string) => {
    const content = rawContent.trim();
    if (!content || Date.now() < suppressSubmissionsUntil) {
      return;
    }

    const status = adapter.getStatus();
    const fingerprint = `${status.currentUrl}::${content}`;

    if (fingerprint === lastFingerprint && Date.now() - lastFingerprintAt < 1_500) {
      return;
    }

    lastFingerprint = fingerprint;
    lastFingerprintAt = Date.now();
    ui.setState('listening', 'sync armed');

    await sendRuntimeMessage(buildUserSubmitMessage(status, content));
    window.setTimeout(() => ui.setState('idle'), 1_500);
  };

  const unsubscribe = adapter.subscribeToUserSubmissions?.((content) => {
    void reportUserSubmit(content);
  });

  const stopObservingUrl = observeUrlChanges(() => {
    void reportPresence('HEARTBEAT');
  });

  const heartbeatInterval = window.setInterval(() => {
    void reportPresence('HEARTBEAT');
  }, 15_000);

  window.addEventListener('focus', () => {
    void reportPresence('HEARTBEAT');
  });

  document.addEventListener('visibilitychange', () => {
    void reportPresence('HEARTBEAT');
  });

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    void (async () => {
      if ((message as PingMessage).type === 'PING') {
        const status = adapter.getStatus();
        const response: PingResponseMessage = {
          type: 'PING_RESPONSE',
          provider: status.provider,
          currentUrl: status.currentUrl,
          sessionId: status.sessionId,
          pageState: status.pageState,
          pageKind: status.pageKind,
        };
        sendResponse(response);
        return;
      }

      if (message.type !== 'DELIVER_PROMPT' || message.provider !== adapter.name) {
        sendResponse({ ok: false, ignored: true });
        return;
      }

      const snapshot = adapter.getStatus();
      if (!adapter.canDeliverPrompt?.(message as DeliverPromptMessage, snapshot)) {
        ui.setState('blocked', 'sync blocked');
        sendResponse({ ok: false, blocked: true, snapshot });
        return;
      }

      try {
        suppressSubmissionsUntil = Date.now() + 2_500;
        ui.setState('syncing', 'syncing');

        const baselineUrl = adapter.getCurrentUrl();
        await adapter.setComposerText?.(message.content);
        await adapter.submit?.();

        void adapter
          .waitForSessionRefUpdate?.(baselineUrl)
          .then(() => sendRuntimeMessage(buildHeartbeatMessage(adapter)))
          .catch(() => null);

        window.setTimeout(() => ui.setState('idle'), 1_500);
        sendResponse({ ok: true });
      } catch (error) {
        ui.setState('blocked', 'sync failed');
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return true;
  });

  void reportPresence('HELLO');

  window.addEventListener('beforeunload', () => {
    unsubscribe?.();
    stopObservingUrl();
    window.clearInterval(heartbeatInterval);
  });
}
