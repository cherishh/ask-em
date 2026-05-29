import type { ProviderAdapter } from '../adapters/types';
import type { ComposerAttachmentPresence } from '../adapters/types';
import type {
  DeliverPromptMessage,
  PingMessage,
  PingResponseMessage,
  RuntimeMessage,
} from '../runtime/protocol';
import { buildHeartbeatMessage, sendRuntimeMessage } from './routing';
import type { ContentStateController } from './state';
import type { ContentSubmitController } from './submit-controller';

const ATTACHMENT_DELIVERY_TIMEOUT_MS = 30_000;
const ATTACHMENT_DELIVERY_POLL_MS = 250;

function countAttachmentPresenceDelta(
  baseline: ComposerAttachmentPresence,
  current: ComposerAttachmentPresence,
): number {
  if (baseline.keys && current.keys) {
    const baselineKeys = new Set(baseline.keys);
    return current.keys.filter((key) => !baselineKeys.has(key)).length;
  }

  return current.count - baseline.count;
}

async function waitForAttachmentPresence(
  composer: NonNullable<ProviderAdapter['composer']>,
  expectedCount: number,
  baseline: ComposerAttachmentPresence,
) {
  if (!composer.getComposerAttachmentPresence) {
    throw new Error('upload failed');
  }

  const deadline = Date.now() + ATTACHMENT_DELIVERY_TIMEOUT_MS;

  while (Date.now() <= deadline) {
    const uploadError = await composer.detectAttachmentUploadError?.();
    if (uploadError) {
      throw new Error('upload failed');
    }

    const current = await composer.getComposerAttachmentPresence();
    if (countAttachmentPresenceDelta(baseline, current) >= expectedCount) {
      return;
    }

    await new Promise((resolve) => window.setTimeout(resolve, ATTACHMENT_DELIVERY_POLL_MS));
  }

  throw new Error('upload failed');
}

export function createDeliveryController(
  adapter: ProviderAdapter,
  state: ContentStateController,
  submitController: Pick<ContentSubmitController, 'suppressObservedSubmissionsFor' | 'rememberProgrammaticSubmit'>,
  dependencies: {
    reportPresence: (kind: 'HELLO' | 'HEARTBEAT') => Promise<void>;
    resetIndicatorPosition: () => Promise<void> | void;
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

      if (message.type === 'RESET_INDICATOR_POSITION') {
        await dependencies.resetIndicatorPosition();
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
        adapter.composer.suppressAttachmentCaptureFor?.(2_500);
        await dependencies.logDebug({
          level: 'info',
          message: 'Starting prompt delivery in content',
          detail: message.content.slice(0, 120),
          workspaceId: message.workspaceId,
        });

        const baselineUrl = adapter.session.getCurrentUrl();
        let attachmentBaseline: ComposerAttachmentPresence | null = null;
        if (message.attachments.length > 0) {
          attachmentBaseline = await adapter.composer.getComposerAttachmentPresence?.() ?? null;
          if (!attachmentBaseline) {
            throw new Error('upload failed');
          }
        }

        if (adapter.composer.setComposerPayload) {
          await adapter.composer.setComposerPayload({
            text: message.content,
            attachments: message.attachments,
          });
        } else {
          await adapter.composer.setComposerText(message.content);
        }

        if (message.attachments.length > 0) {
          const baseline = attachmentBaseline;
          if (!baseline) {
            throw new Error('upload failed');
          }

          await waitForAttachmentPresence(
            adapter.composer,
            message.attachments.length,
            baseline,
          );
        }

        submitController.rememberProgrammaticSubmit(message.content);
        await adapter.composer.submit({
          timeoutMs: message.attachments.length > 0 ? ATTACHMENT_DELIVERY_TIMEOUT_MS : undefined,
        });

        const shouldAwaitSessionRef =
          snapshot.sessionId === null ||
          message.expectedSessionId === null ||
          snapshot.pageKind === 'new-chat';

        if (shouldAwaitSessionRef) {
          try {
            const ref = await adapter.session.waitForSessionRefUpdate?.(baselineUrl);
            if (ref) {
              await dependencies.logDebug({
                level: 'info',
                message: 'Observed session ref update',
                detail: ref.url,
                workspaceId: message.workspaceId,
              });
            }
            await sendRuntimeMessage(buildHeartbeatMessage(adapter), {
              onError(error) {
                console.warn('ask-em: failed to report post-delivery heartbeat', error);
              },
            });
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            await dependencies.logDebug({
              level: 'warn',
              message: 'Expected session ref update was not observed',
              detail: reason,
              workspaceId: message.workspaceId,
            });
            state.showCurrentWarning('Delivery failed');
            sendResponse({
              ok: false,
              accepted: true,
              confirmed: false,
              error: reason,
            });
            return;
          }
        }

        sendResponse({ ok: true, accepted: true, confirmed: true });
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
