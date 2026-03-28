import type { SiteAdapter } from '../adapters/types';
import type {
  DeliverPromptMessage,
  PingMessage,
  PingResponseMessage,
  RuntimeMessage,
  WorkspaceContextResponseMessage,
} from '../runtime/protocol';
import {
  buildHeartbeatMessage,
  buildHelloMessage,
  buildUserSubmitMessage,
  observeUrlChanges,
  sendRuntimeMessage,
} from './content-routing';
import { createContentUi, type UiContext } from './content-ui';

function shouldShowStandaloneIndicator(adapter: SiteAdapter): boolean {
  const status = adapter.getStatus();
  return status.pageKind === 'new-chat' && status.pageState === 'ready';
}

export function bootstrapContentScript(adapter: SiteAdapter): void {
  let uiContext: UiContext = {
    workspaceId: null,
    providerEnabled: true,
    globalSyncEnabled: true,
  };

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
    const status = adapter.getStatus();
    const response =
      kind === 'HELLO'
        ? await sendRuntimeMessage<{
            workspaceId?: string | null;
            providerEnabled?: boolean;
            globalSyncEnabled?: boolean;
          }>(buildHelloMessage(adapter))
        : await sendRuntimeMessage<{
            workspaceId?: string | null;
            providerEnabled?: boolean;
            globalSyncEnabled?: boolean;
          }>(buildHeartbeatMessage(adapter));

    const standaloneVisible = shouldShowStandaloneIndicator(adapter);
    uiContext = {
      workspaceId: response?.workspaceId ?? null,
      providerEnabled: response?.workspaceId ? (response.providerEnabled ?? false) : true,
      globalSyncEnabled: response?.globalSyncEnabled ?? true,
    };
    ui.setContext(uiContext);
    ui.setVisible(Boolean(response?.workspaceId) || standaloneVisible);

    if (!response?.workspaceId && !standaloneVisible) {
      return;
    }

    if (!response?.workspaceId && status.pageKind === 'new-chat') {
      ui.setState('idle');
    }
  };

  const ui = createContentUi(adapter, {
    async onWorkspaceProviderToggle(provider, nextEnabled) {
      if (!uiContext.workspaceId) {
        return;
      }

      await sendRuntimeMessage({
        type: 'SET_WORKSPACE_PROVIDER_ENABLED',
        workspaceId: uiContext.workspaceId,
        provider,
        enabled: nextEnabled,
      });

      if (provider === adapter.name) {
        uiContext = {
          ...uiContext,
          providerEnabled: nextEnabled,
        };
        ui.setContext(uiContext);
        ui.setState('idle');
      }
    },
    async loadWorkspaceContext(workspaceId) {
      return await sendRuntimeMessage<WorkspaceContextResponseMessage>({
        type: 'GET_WORKSPACE_CONTEXT',
        workspaceId,
      });
    },
    async onRefreshContext() {
      await reportPresence('HELLO');
    },
  });

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
    ui.setState('listening', 'sync');
    await logDebug({
      level: 'info',
      message: 'Detected user submit',
      detail: content.slice(0, 120),
    });

    const response = await sendRuntimeMessage<{
      workspaceId?: string | null;
      synced?: boolean;
      providerEnabled?: boolean;
      globalSyncEnabled?: boolean;
    }>(buildUserSubmitMessage(status, content));

    uiContext = {
      workspaceId: response?.workspaceId ?? null,
      providerEnabled: response?.workspaceId ? (response.providerEnabled ?? true) : true,
      globalSyncEnabled: response?.globalSyncEnabled ?? uiContext.globalSyncEnabled,
    };
    ui.setContext(uiContext);
    ui.setVisible(Boolean(uiContext.workspaceId) || shouldShowStandaloneIndicator(adapter));
    ui.setState('idle');

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

      if (message.type === 'REFRESH_CONTENT_CONTEXT') {
        await reportPresence('HELLO');
        sendResponse({ ok: true });
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
        ui.setState('blocked', 'paused');
        sendResponse({ ok: false, blocked: true, snapshot });
        return;
      }

      try {
        suppressSubmissionsUntil = Date.now() + 2_500;
        ui.setState('syncing', 'sync');
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
        ui.setState('blocked', 'paused');
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
