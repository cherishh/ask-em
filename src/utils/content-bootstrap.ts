import type { SiteAdapter } from '../adapters/types';
import type { DeliverPromptMessage, PingMessage, PingResponseMessage, RuntimeMessage } from '../runtime/protocol';
import {
  buildHeartbeatMessage,
  buildHelloMessage,
  buildUserSubmitMessage,
  observeUrlChanges,
  sendRuntimeMessage,
} from './content-routing';

type UiState = 'idle' | 'listening' | 'syncing' | 'blocked';

type UiContext = {
  workspaceId: string | null;
  providerEnabled: boolean;
};

function ensureUi(adapter: SiteAdapter, onToggle: (nextEnabled: boolean) => Promise<void>) {
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
        min-height: 30px;
        padding: 0 12px;
        border-radius: 999px;
        border: 1px solid rgba(15, 23, 42, 0.22);
        background: rgba(255, 252, 246, 0.96);
        backdrop-filter: blur(16px) saturate(1.35);
        box-shadow:
          0 14px 34px rgba(15, 23, 42, 0.18),
          inset 0 1px 0 rgba(255, 255, 255, 0.72);
        color: rgba(15, 23, 42, 0.84);
        font: 700 11px/1.1 "SF Mono", "IBM Plex Mono", Menlo, Monaco, Consolas, monospace;
        letter-spacing: 0.11em;
        text-transform: uppercase;
        opacity: 0.96;
        transform: translateY(0);
        transition:
          opacity 180ms ease,
          border-color 180ms ease,
          color 180ms ease,
          background 180ms ease,
          box-shadow 180ms ease;
        pointer-events: auto;
        user-select: none;
        cursor: default;
      }

      .ask-em-sync-pill[data-interactive="true"] {
        cursor: pointer;
      }

      .ask-em-sync-pill:hover {
        opacity: 0.98;
      }

      .ask-em-sync-pill::before {
        content: "";
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: var(--ask-em-accent, rgba(15, 23, 42, 0.45));
        box-shadow:
          0 0 0 2px color-mix(in srgb, var(--ask-em-accent, #0f172a) 16%, transparent),
          0 0 10px color-mix(in srgb, var(--ask-em-accent, #0f172a) 18%, transparent);
      }

      .ask-em-sync-pill[data-state="idle"] {
        --ask-em-accent: rgba(22, 163, 74, 0.95);
        border-color: rgba(22, 163, 74, 0.2);
      }

      .ask-em-sync-pill[data-state="idle"][data-provider-enabled="true"]::before,
      .ask-em-sync-pill[data-state="listening"][data-provider-enabled="true"]::before,
      .ask-em-sync-pill[data-state="syncing"][data-provider-enabled="true"]::before {
        animation: ask-em-pulse 1.2s ease-in-out infinite;
      }

      .ask-em-sync-pill[data-state="listening"] {
        border-color: rgba(22, 163, 74, 0.24);
        background: rgba(243, 252, 245, 0.97);
        --ask-em-accent: rgba(22, 163, 74, 0.95);
      }

      .ask-em-sync-pill[data-state="syncing"] {
        border-color: rgba(22, 163, 74, 0.26);
        background: rgba(241, 252, 245, 0.98);
        color: rgba(15, 23, 42, 0.92);
        --ask-em-accent: rgba(22, 163, 74, 0.95);
      }

      .ask-em-sync-pill[data-state="blocked"] {
        border-color: rgba(217, 119, 6, 0.34);
        background: rgba(255, 249, 235, 0.98);
        color: rgba(120, 53, 15, 0.9);
        --ask-em-accent: rgba(245, 158, 11, 0.96);
      }

      .ask-em-sync-pill[data-provider-enabled="false"] {
        border-color: rgba(120, 113, 108, 0.2);
        background: rgba(246, 244, 241, 0.98);
        color: rgba(68, 64, 60, 0.88);
        --ask-em-accent: rgba(120, 113, 108, 0.84);
      }

      .ask-em-sync-pill[data-busy="true"] {
        opacity: 0.94;
        cursor: progress;
      }

      .ask-em-pill-label {
        white-space: nowrap;
      }

      .ask-em-pill-toggle {
        position: relative;
        display: inline-flex;
        align-items: center;
        width: 26px;
        height: 14px;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.38);
        transition: background 180ms ease;
      }

      .ask-em-pill-toggle::after {
        content: "";
        position: absolute;
        left: 2px;
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 1px 6px rgba(15, 23, 42, 0.2);
        transition: transform 180ms ease;
      }

      .ask-em-sync-pill[data-provider-enabled="true"] .ask-em-pill-toggle {
        background: var(--ask-em-accent, rgba(22, 163, 74, 0.95));
      }

      .ask-em-sync-pill[data-provider-enabled="true"] .ask-em-pill-toggle::after {
        transform: translateX(12px);
      }

      @keyframes ask-em-pulse {
        0%,
        100% {
          transform: scale(0.94);
          box-shadow:
            0 0 0 2px color-mix(in srgb, var(--ask-em-accent, #16a34a) 18%, transparent),
            0 0 7px color-mix(in srgb, var(--ask-em-accent, #16a34a) 14%, transparent);
        }

        50% {
          transform: scale(1.04);
          box-shadow:
            0 0 0 4px color-mix(in srgb, var(--ask-em-accent, #16a34a) 20%, transparent),
            0 0 11px color-mix(in srgb, var(--ask-em-accent, #16a34a) 20%, transparent);
        }
      }
    `;
    document.documentElement.appendChild(style);
  }

  let mount = document.getElementById(mountId) as HTMLButtonElement | null;
  if (!mount) {
    mount = document.createElement('button');
    mount.type = 'button';
    mount.id = mountId;
    mount.className = className;
    mount.classList.add('ask-em-sync-pill');
    mount.dataset.state = 'idle';
    mount.dataset.providerEnabled = 'true';
    mount.dataset.interactive = 'false';
    mount.innerHTML = `
      <span class="ask-em-pill-label">${adapter.name} ready</span>
      <span class="ask-em-pill-toggle" aria-hidden="true"></span>
    `;
    document.body.appendChild(mount);
  }

  const label = mount.querySelector('.ask-em-pill-label');
  const context: UiContext = {
    workspaceId: null,
    providerEnabled: true,
  };

  const updateLabel = (text: string) => {
    if (label) {
      label.textContent = text;
    }
  };

  const getDefaultLabel = () =>
    context.workspaceId
      ? `${adapter.name} ${context.providerEnabled ? 'sync' : 'paused'}`
      : `${adapter.name} ready`;

  mount.addEventListener('click', () => {
    if (mount?.dataset.interactive !== 'true' || mount.dataset.busy === 'true') {
      return;
    }

    mount.dataset.busy = 'true';
    void onToggle(!context.providerEnabled).finally(() => {
      if (mount) {
        mount.dataset.busy = 'false';
      }
    });
  });

  return {
    setState(state: UiState, labelText?: string) {
      mount.dataset.state = state;
      updateLabel(labelText ?? getDefaultLabel());
    },
    setContext(nextContext: UiContext) {
      context.workspaceId = nextContext.workspaceId;
      context.providerEnabled = nextContext.providerEnabled;
      mount.dataset.providerEnabled = String(nextContext.providerEnabled);
      mount.dataset.interactive = String(Boolean(nextContext.workspaceId));
      updateLabel(getDefaultLabel());
    },
  };
}

export function bootstrapContentScript(adapter: SiteAdapter): void {
  let uiContext: UiContext = {
    workspaceId: null,
    providerEnabled: true,
  };

  const ui = ensureUi(adapter, async (nextEnabled) => {
    if (!uiContext.workspaceId) {
      return;
    }

    await sendRuntimeMessage({
      type: 'SET_WORKSPACE_PROVIDER_ENABLED',
      workspaceId: uiContext.workspaceId,
      provider: adapter.name,
      enabled: nextEnabled,
    });

    uiContext = {
      ...uiContext,
      providerEnabled: nextEnabled,
    };
    ui.setContext(uiContext);
    ui.setState('idle');
  });

  let suppressSubmissionsUntil = 0;
  let lastFingerprint = '';
  let lastFingerprintAt = 0;

  const logDebug = async (entry: {
    level: 'info' | 'warn' | 'error';
    message: string;
    detail?: string;
    workspaceId?: string;
  }) => {
    await sendRuntimeMessage({
      type: 'LOG_DEBUG',
      level: entry.level,
      scope: 'content',
      provider: adapter.name,
      workspaceId: entry.workspaceId ?? uiContext.workspaceId ?? undefined,
      message: entry.message,
      detail: entry.detail,
    });
  };

  const reportPresence = async (kind: 'HELLO' | 'HEARTBEAT') => {
    const response =
      kind === 'HELLO'
        ? await sendRuntimeMessage<{ workspaceId?: string | null; providerEnabled?: boolean }>(
            buildHelloMessage(adapter),
          )
        : await sendRuntimeMessage<{ workspaceId?: string | null; providerEnabled?: boolean }>(
            buildHeartbeatMessage(adapter),
          );

    uiContext = {
      workspaceId: response?.workspaceId ?? null,
      providerEnabled: response?.workspaceId ? (response.providerEnabled ?? false) : true,
    };
    ui.setContext(uiContext);
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
    ui.setState('listening', `${adapter.name} armed`);
    await logDebug({
      level: 'info',
      message: 'Detected user submit',
      detail: content.slice(0, 120),
    });

    const response = await sendRuntimeMessage<{ workspaceId?: string | null; synced?: boolean }>(
      buildUserSubmitMessage(status, content),
    );

    if (response?.workspaceId) {
      uiContext = {
        workspaceId: response.workspaceId,
        providerEnabled: true,
      };
      ui.setContext(uiContext);
      ui.setState('idle');
    }

    window.setTimeout(() => ui.setState(uiContext.providerEnabled ? 'idle' : 'blocked'), 1_500);
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
        await logDebug({
          level: 'warn',
          message: 'Blocked prompt delivery in content',
          detail: JSON.stringify(snapshot),
          workspaceId: message.workspaceId,
        });
        ui.setState('blocked', `${adapter.name} blocked`);
        sendResponse({ ok: false, blocked: true, snapshot });
        return;
      }

      try {
        suppressSubmissionsUntil = Date.now() + 2_500;
        ui.setState('syncing', `${adapter.name} sync`);
        await logDebug({
          level: 'info',
          message: 'Starting prompt delivery in content',
          detail: message.content.slice(0, 120),
          workspaceId: message.workspaceId,
        });

        const baselineUrl = adapter.getCurrentUrl();
        await adapter.setComposerText?.(message.content);
        await adapter.submit?.();

        const shouldAwaitSessionRef =
          snapshot.sessionId === null ||
          message.expectedSessionId === null ||
          snapshot.pageKind === 'new-chat';

        if (shouldAwaitSessionRef) {
          void adapter
            .waitForSessionRefUpdate?.(baselineUrl)
            .then(async (ref) => {
              await logDebug({
                level: 'info',
                message: 'Observed session ref update',
                detail: ref.url,
                workspaceId: message.workspaceId,
              });
              return sendRuntimeMessage(buildHeartbeatMessage(adapter));
            })
            .catch(async (error) => {
              await logDebug({
                level: 'warn',
                message: 'Expected session ref update was not observed',
                detail: error instanceof Error ? error.message : String(error),
                workspaceId: message.workspaceId,
              });
            });
        }

        window.setTimeout(() => ui.setState('idle'), 1_500);
        sendResponse({ ok: true });
      } catch (error) {
        await logDebug({
          level: 'error',
          message: 'Content delivery failed',
          detail: error instanceof Error ? error.message : String(error),
          workspaceId: message.workspaceId,
        });
        ui.setState('blocked', `${adapter.name} failed`);
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
