import type { ProviderAdapter } from '../adapters/types';
import type {
  DeliverPromptMessage,
  PingMessage,
  PingResponseMessage,
  ProviderDeliveryResult,
  RuntimeMessage,
  ShortcutConfig,
  WorkspaceContextResponseMessage,
} from '../runtime/protocol';
import { DEFAULT_SHORTCUTS, resolveShortcutConfig } from '../runtime/protocol';
import {
  buildHeartbeatMessage,
  buildHelloMessage,
  buildUserSubmitMessage,
  observeUrlChanges,
  sendRuntimeMessage,
} from './content-routing';
import { createContentUi, type SyncIndicatorTone, type UiContext } from './content-ui';

const STARTUP_PRESENCE_POLL_MS = 1_000;
const STARTUP_PRESENCE_DURATION_MS = 10_000;
const PROGRAMMATIC_SUBMIT_SUPPRESS_MS = 30_000;

function shouldShowStandaloneIndicator(adapter: ProviderAdapter): boolean {
  const status = adapter.session.getStatus();
  return status.pageKind === 'new-chat' && status.pageState === 'ready';
}

function formatModelCount(count: number): string {
  return `${count} ${count === 1 ? 'model' : 'models'}`;
}

export function bootstrapContentScript(adapter: ProviderAdapter): void {
  let uiContext: UiContext = {
    workspaceId: null,
    providerEnabled: true,
    globalSyncEnabled: true,
    standaloneReady: false,
    standaloneCreateSetEnabled: true,
    canStartNewSet: true,
    shortcuts: DEFAULT_SHORTCUTS,
  };

  let suppressSubmissionsUntil = 0;
  let lastFingerprint = '';
  let lastFingerprintAt = 0;
  const recentProgrammaticSubmits = new Map<string, number>();
  let startupPresenceInterval: number | null = null;
  let startupPresenceDeadline = 0;

  const stopStartupPresencePolling = () => {
    if (startupPresenceInterval !== null) {
      window.clearInterval(startupPresenceInterval);
      startupPresenceInterval = null;
    }
  };

  const shouldContinueStartupPresencePolling = () =>
    Date.now() < startupPresenceDeadline &&
    !uiContext.workspaceId &&
    !shouldShowStandaloneIndicator(adapter);

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

  const getStandaloneUiState = (context: UiContext): 'idle' | 'blocked' => {
    if (!context.standaloneReady || context.workspaceId) {
      return 'idle';
    }

    if (!context.globalSyncEnabled || !context.canStartNewSet || !context.standaloneCreateSetEnabled) {
      return 'blocked';
    }

    return 'idle';
  };

  const getRestingUiState = (context: UiContext): 'idle' | 'blocked' => {
    if (!context.workspaceId) {
      return getStandaloneUiState(context);
    }

    if (!context.globalSyncEnabled || !context.providerEnabled) {
      return 'blocked';
    }

    return 'idle';
  };

  const getDeliveryResultPresentation = (deliveryResults: ProviderDeliveryResult[]) => {
    const total = deliveryResults.length;
    if (total === 0) {
      return null;
    }

    const failed = deliveryResults.filter((result) => !result.ok);
    const succeeded = total - failed.length;

    if (failed.length === 0) {
      return {
        state: 'idle' as const,
        label: `Synced to ${formatModelCount(total)}`,
        tone: 'success' as SyncIndicatorTone,
      };
    }

    if (succeeded === 0) {
      return {
        state: 'blocked' as const,
        label: failed.length === 1 ? `${failed[0].provider} failed` : 'Sync failed',
        tone: 'warning' as SyncIndicatorTone,
      };
    }

    return {
      state: 'blocked' as const,
      label: failed.length === 1 ? `${failed[0].provider} failed` : `${failed.length} providers failed`,
      tone: 'warning' as SyncIndicatorTone,
    };
  };

  const getNoDeliveryPresentation = (response: {
    synced?: boolean;
    providerEnabled?: boolean;
    globalSyncEnabled?: boolean;
  } | null) => {
    if (!response) {
      return {
        label: 'Sync status unavailable',
        tone: 'warning' as SyncIndicatorTone,
      };
    }

    if (!response.globalSyncEnabled) {
      return {
        label: 'Prompt stayed here',
        tone: 'neutral' as SyncIndicatorTone,
      };
    }

    if (response.providerEnabled === false) {
      return {
        label: 'This tab is paused',
        tone: 'neutral' as SyncIndicatorTone,
      };
    }

    if (response.synced === false) {
      return {
        label: 'No fan-out sent',
        tone: 'neutral' as SyncIndicatorTone,
      };
    }

    return null;
  };

  const getSubmitContentFingerprint = (content: string) => content.trim();

  const rememberProgrammaticSubmit = (content: string) => {
    recentProgrammaticSubmits.set(
      getSubmitContentFingerprint(content),
      Date.now() + PROGRAMMATIC_SUBMIT_SUPPRESS_MS,
    );
  };

  const shouldSuppressProgrammaticSubmit = (content: string) => {
    const now = Date.now();

    for (const [fingerprint, expiresAt] of recentProgrammaticSubmits) {
      if (expiresAt <= now) {
        recentProgrammaticSubmits.delete(fingerprint);
      }
    }

    const fingerprint = getSubmitContentFingerprint(content);
    const expiresAt = recentProgrammaticSubmits.get(fingerprint);

    if (!expiresAt || expiresAt <= now) {
      return false;
    }

    recentProgrammaticSubmits.delete(fingerprint);
    return true;
  };

  const reportPresence = async (kind: 'HELLO' | 'HEARTBEAT') => {
    const status = adapter.session.getStatus();
    const response =
      kind === 'HELLO'
        ? await sendRuntimeMessage<{
            workspaceId?: string | null;
            providerEnabled?: boolean;
            globalSyncEnabled?: boolean;
            canStartNewSet?: boolean;
            shortcuts?: ShortcutConfig;
          }>(buildHelloMessage(adapter))
        : await sendRuntimeMessage<{
            workspaceId?: string | null;
            providerEnabled?: boolean;
            globalSyncEnabled?: boolean;
            canStartNewSet?: boolean;
            shortcuts?: ShortcutConfig;
          }>(buildHeartbeatMessage(adapter));

    const standaloneVisible = shouldShowStandaloneIndicator(adapter);
    const standaloneCreateSetEnabled = response?.workspaceId
      ? true
      : uiContext.standaloneCreateSetEnabled;
    uiContext = {
      workspaceId: response?.workspaceId ?? null,
      providerEnabled: response?.workspaceId ? (response.providerEnabled ?? false) : true,
      globalSyncEnabled: response?.globalSyncEnabled ?? true,
      standaloneReady: standaloneVisible,
      standaloneCreateSetEnabled,
      canStartNewSet: response?.canStartNewSet ?? true,
      shortcuts: resolveShortcutConfig(response?.shortcuts ?? uiContext.shortcuts),
    };
    ui.setContext(uiContext);
    ui.setVisible(Boolean(response?.workspaceId) || standaloneVisible);

    if (!shouldContinueStartupPresencePolling()) {
      stopStartupPresencePolling();
    }

    if (!response?.workspaceId && !standaloneVisible) {
      return;
    }

    if (!response?.workspaceId && status.pageKind === 'new-chat') {
      ui.setState(getStandaloneUiState(uiContext));
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
        ui.setState(getRestingUiState(uiContext));
      }
    },
    onStandaloneSetCreationToggle(nextEnabled) {
      uiContext = {
        ...uiContext,
        standaloneCreateSetEnabled: nextEnabled,
      };
      ui.setContext(uiContext);
      ui.setState(getStandaloneUiState(uiContext));
    },
    async onProviderTabSwitch(direction) {
      return await sendRuntimeMessage<{
        ok?: boolean;
        switched?: boolean;
        provider?: typeof adapter.name;
        reason?: string;
      }>({
        type: 'SWITCH_PROVIDER_TAB',
        provider: adapter.name,
        direction,
      });
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

    if (shouldSuppressProgrammaticSubmit(content)) {
      await logDebug({
        level: 'info',
        message: 'Skipped programmatic submit echo',
        detail: content.slice(0, 120),
      });
      return;
    }

    const status = adapter.session.getStatus();
    const fingerprint = `${status.currentUrl}::${content}`;

    if (fingerprint === lastFingerprint && Date.now() - lastFingerprintAt < 1_500) {
      return;
    }

    lastFingerprint = fingerprint;
    lastFingerprintAt = Date.now();

    if (
      !uiContext.workspaceId &&
      status.pageKind === 'new-chat' &&
      status.sessionId === null &&
      !uiContext.standaloneCreateSetEnabled
    ) {
      ui.setState(getStandaloneUiState(uiContext));
      await logDebug({
        level: 'info',
        message: 'Skipped new set creation for standalone chat',
        detail: content.slice(0, 120),
      });
      return;
    }

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
      canStartNewSet?: boolean;
      deliveryResults?: ProviderDeliveryResult[];
    }>(buildUserSubmitMessage(status, content));

    const standaloneReady = shouldShowStandaloneIndicator(adapter);
    uiContext = {
      workspaceId: response?.workspaceId ?? null,
      providerEnabled: response?.workspaceId ? (response.providerEnabled ?? true) : true,
      globalSyncEnabled: response?.globalSyncEnabled ?? uiContext.globalSyncEnabled,
      standaloneReady,
      standaloneCreateSetEnabled: response?.workspaceId
        ? true
        : uiContext.standaloneCreateSetEnabled,
      canStartNewSet: response?.canStartNewSet ?? uiContext.canStartNewSet,
      shortcuts: uiContext.shortcuts,
    };
    ui.setContext(uiContext);
    ui.setVisible(Boolean(uiContext.workspaceId) || standaloneReady);
    const deliveryPresentation =
      response?.synced && response.deliveryResults
        ? getDeliveryResultPresentation(response.deliveryResults)
        : null;

    if (deliveryPresentation) {
      ui.setState(deliveryPresentation.state);
      ui.setSyncStatus(deliveryPresentation.label, deliveryPresentation.tone);
    } else {
      const noDeliveryPresentation = getNoDeliveryPresentation(response);
      ui.setState(getRestingUiState(uiContext));
      if (noDeliveryPresentation) {
        ui.setSyncStatus(noDeliveryPresentation.label, noDeliveryPresentation.tone);
      }
    }
  };

  const unsubscribe = adapter.composer?.subscribeToUserSubmissions?.((content) => {
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
        const status = adapter.session.getStatus();
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

      const snapshot = adapter.session.getStatus();
      if (!adapter.session.canDeliverPrompt?.(message as DeliverPromptMessage, snapshot)) {
        await logDebug({
          level: 'warn',
          message: 'Blocked prompt delivery in content',
          detail: JSON.stringify(snapshot),
          workspaceId: message.workspaceId,
        });
        ui.setState('blocked');
        ui.setSyncStatus('Delivery blocked', 'warning');
        sendResponse({ ok: false, blocked: true, snapshot });
        return;
      }

      if (!adapter.composer) {
        await logDebug({
          level: 'warn',
          message: 'Blocked prompt delivery because provider has no composer adapter',
          workspaceId: message.workspaceId,
        });
        ui.setState('blocked');
        ui.setSyncStatus('Delivery blocked', 'warning');
        sendResponse({ ok: false, blocked: true, error: 'Provider does not support prompt delivery' });
        return;
      }

      try {
        suppressSubmissionsUntil = Date.now() + 2_500;
        await logDebug({
          level: 'info',
          message: 'Starting prompt delivery in content',
          detail: message.content.slice(0, 120),
          workspaceId: message.workspaceId,
        });

        const baselineUrl = adapter.session.getCurrentUrl();
        await adapter.composer.setComposerText(message.content);
        rememberProgrammaticSubmit(message.content);
        await adapter.composer.submit();

        const shouldAwaitSessionRef =
          snapshot.sessionId === null ||
          message.expectedSessionId === null ||
          snapshot.pageKind === 'new-chat';

        if (shouldAwaitSessionRef) {
          void adapter
            .session.waitForSessionRefUpdate?.(baselineUrl)
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

        ui.setState('idle');
        ui.setSyncStatus('Received synced prompt', 'success');
        sendResponse({ ok: true });
      } catch (error) {
        await logDebug({
          level: 'error',
          message: 'Content delivery failed',
          detail: error instanceof Error ? error.message : String(error),
          workspaceId: message.workspaceId,
        });
        ui.setState('blocked');
        ui.setSyncStatus('Delivery failed', 'warning');
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return true;
  });

  startStartupPresencePolling();
  void reportPresence('HELLO');

  window.addEventListener('beforeunload', () => {
    unsubscribe?.();
    stopObservingUrl();
    stopStartupPresencePolling();
    window.clearInterval(heartbeatInterval);
  });
}
