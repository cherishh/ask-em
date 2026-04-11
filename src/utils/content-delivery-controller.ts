import type { ProviderAdapter } from '../adapters/types';
import type {
  DeliverPromptMessage,
  PingMessage,
  PingResponseMessage,
  RuntimeMessage,
} from '../runtime/protocol';
import { buildHeartbeatMessage, sendRuntimeMessage } from './content-routing';
import type { ContentStateController } from './content-state';
import type { ContentSubmitController } from './content-submit-controller';

export function createDeliveryController(
  adapter: ProviderAdapter,
  state: ContentStateController,
  submitController: Pick<ContentSubmitController, 'suppressObservedSubmissionsFor' | 'rememberProgrammaticSubmit'>,
  dependencies: {
    reportPresence: (kind: 'HELLO' | 'HEARTBEAT') => Promise<void>;
    logDebug: (entry: {
      level: 'info' | 'warn' | 'error';
      message: string;
      detail?: string;
      workspaceId?: string;
    }) => Promise<void>;
  },
) {
  const handleRuntimeMessage = (
    message: RuntimeMessage,
    sendResponse: (response?: unknown) => void,
  ) => {
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
        await dependencies.reportPresence('HELLO');
        sendResponse({ ok: true });
        return;
      }

      if (message.type === 'SYNC_PROGRESS') {
        state.handleSyncProgress({
          workspaceId: message.workspaceId,
          total: message.total,
          completed: message.completed,
          succeeded: message.succeeded,
          failed: message.failed,
        });
        sendResponse({ ok: true });
        return;
      }

      if (message.type !== 'DELIVER_PROMPT' || message.provider !== adapter.name) {
        sendResponse({ ok: false, ignored: true });
        return;
      }

      const snapshot = adapter.session.getStatus();
      if (!adapter.session.canDeliverPrompt?.(message as DeliverPromptMessage, snapshot)) {
        await dependencies.logDebug({
          level: 'warn',
          message: 'Blocked prompt delivery in content',
          detail: JSON.stringify(snapshot),
          workspaceId: message.workspaceId,
        });
        state.showCurrentWarning('Delivery blocked');
        sendResponse({ ok: false, blocked: true, snapshot });
        return;
      }

      if (!adapter.composer) {
        await dependencies.logDebug({
          level: 'warn',
          message: 'Blocked prompt delivery because provider has no composer adapter',
          workspaceId: message.workspaceId,
        });
        state.showCurrentWarning('Delivery blocked');
        sendResponse({ ok: false, blocked: true, error: 'Provider does not support prompt delivery' });
        return;
      }

      try {
        submitController.suppressObservedSubmissionsFor(2_500);
        await dependencies.logDebug({
          level: 'info',
          message: 'Starting prompt delivery in content',
          detail: message.content.slice(0, 120),
          workspaceId: message.workspaceId,
        });

        const baselineUrl = adapter.session.getCurrentUrl();
        await adapter.composer.setComposerText(message.content);
        submitController.rememberProgrammaticSubmit(message.content);
        await adapter.composer.submit();

        const shouldAwaitSessionRef =
          snapshot.sessionId === null ||
          message.expectedSessionId === null ||
          snapshot.pageKind === 'new-chat';

        if (shouldAwaitSessionRef) {
          void adapter.session.waitForSessionRefUpdate?.(baselineUrl).then(async (ref) => {
            await dependencies.logDebug({
              level: 'info',
              message: 'Observed session ref update',
              detail: ref.url,
              workspaceId: message.workspaceId,
            });
            return sendRuntimeMessage(buildHeartbeatMessage(adapter));
          }).catch(async (error) => {
            await dependencies.logDebug({
              level: 'warn',
              message: 'Expected session ref update was not observed',
              detail: error instanceof Error ? error.message : String(error),
              workspaceId: message.workspaceId,
            });
          });
        }

        sendResponse({ ok: true });
        void dependencies.reportPresence('HELLO');
      } catch (error) {
        await dependencies.logDebug({
          level: 'error',
          message: 'Content delivery failed',
          detail: error instanceof Error ? error.message : String(error),
          workspaceId: message.workspaceId,
        });
        state.showCurrentWarning('Delivery failed');
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return true;
  };

  return {
    handleRuntimeMessage,
  };
}

export type ContentDeliveryController = ReturnType<typeof createDeliveryController>;
