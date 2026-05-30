import type { ProviderAdapter } from '../adapters/types';
import type { ComposerAttachmentPresence } from '../adapters/types';
import { countAttachmentPresenceDelta } from '../adapters/attachment-presence';
import type {
  AttachmentRef,
  DeliverPromptMessage,
  PingMessage,
  PingResponseMessage,
  RuntimeMessage,
} from '../runtime/protocol';
import { formatAttachmentSummary } from '../runtime/attachment-log';
import { buildHeartbeatMessage, sendRuntimeMessage } from './routing';
import type { ContentStateController } from './state';
import type { ContentSubmitController } from './submit-controller';

const ATTACHMENT_DELIVERY_TIMEOUT_MS = 30_000;
const ATTACHMENT_DELIVERY_POLL_MS = 250;
const PROGRAMMATIC_SUBMIT_BUFFER_MS = 10_000;

function getDeliveryWarningLabel(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return reason.toLowerCase().includes('upload failed') ? 'upload failed' : 'Delivery failed';
}

async function waitForAttachmentPresence(
  composer: NonNullable<ProviderAdapter['composer']>,
  expectedAttachments: AttachmentRef[],
  baseline: ComposerAttachmentPresence,
): Promise<ComposerAttachmentPresence> {
  if (!composer.getComposerAttachmentPresence) {
    throw new Error('upload failed');
  }

  const expectedCount = expectedAttachments.length;
  const deadline = Date.now() + ATTACHMENT_DELIVERY_TIMEOUT_MS;
  let lastPresence = baseline;

  while (Date.now() <= deadline) {
    const uploadError = await composer.detectAttachmentUploadError?.();
    if (uploadError) {
      throw new Error(uploadError);
    }

    const current = await composer.getComposerAttachmentPresence(expectedAttachments);
    lastPresence = current;
    if (countAttachmentPresenceDelta(baseline, current) >= expectedCount) {
      return current;
    }

    await new Promise((resolve) => globalThis.setTimeout(resolve, ATTACHMENT_DELIVERY_POLL_MS));
  }

  throw new Error(
    `upload failed: attachment presence timeout expected=${expectedCount}; baseline=${baseline.count}; current=${lastPresence.count}`,
  );
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
        const submitTimeoutMs = message.attachments.length > 0 ? ATTACHMENT_DELIVERY_TIMEOUT_MS : undefined;
        const suppressionMs = (submitTimeoutMs ?? 2_500) + PROGRAMMATIC_SUBMIT_BUFFER_MS;
        submitController.suppressObservedSubmissionsFor(suppressionMs);
        // Capture suppression must cover the WHOLE delivery window, not a fixed
        // 2.5s: a target's injection (readAttachmentFiles over the message bus +
        // file-input `change`) can land well after 2.5s within the 30s attachment
        // window, otherwise the injected files get re-captured as the target tab's
        // own source attachments and leak into its next user submit.
        adapter.composer.suppressAttachmentCaptureFor?.(suppressionMs);
        await dependencies.logDebug({
          level: 'info',
          message: 'Starting prompt delivery in content',
          detail: `${message.content.slice(0, 120)}; attachments=${message.attachments.length}`,
          workspaceId: message.workspaceId,
        });

        const baselineUrl = adapter.session.getCurrentUrl();
        await adapter.composer.prepareForDelivery?.({
          text: message.content,
          attachments: message.attachments,
          expectedSessionId: message.expectedSessionId,
          expectedUrl: message.expectedUrl,
        });

        let attachmentBaseline: ComposerAttachmentPresence | null = null;
        if (message.attachments.length > 0) {
          await dependencies.logDebug({
            level: 'info',
            message: 'Attachment delivery started',
            detail: formatAttachmentSummary(message.attachments),
            workspaceId: message.workspaceId,
          });
          attachmentBaseline = await adapter.composer.getComposerAttachmentPresence?.(message.attachments) ?? null;
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

        await dependencies.logDebug({
          level: 'info',
          message: 'Prompt payload injected',
          detail: `attachments=${message.attachments.length}`,
          workspaceId: message.workspaceId,
        });

        if (message.attachments.length > 0) {
          const baseline = attachmentBaseline;
          if (!baseline) {
            throw new Error('upload failed');
          }

          const currentPresence = await waitForAttachmentPresence(
            adapter.composer,
            message.attachments,
            baseline,
          );

          await dependencies.logDebug({
            level: 'info',
            message: 'Attachment delivery confirmed',
            detail: `expected=${message.attachments.length}; baseline=${baseline.count}; current=${currentPresence.count}; keys=${(currentPresence.keys ?? []).slice(0, 5).join(' | ')}`,
            workspaceId: message.workspaceId,
          });
        }

        await dependencies.logDebug({
          level: 'info',
          message: 'Submitting prompt in content',
          detail: `attachments=${message.attachments.length}`,
          workspaceId: message.workspaceId,
        });
        submitController.suppressObservedSubmissionsFor(suppressionMs);
        adapter.composer.suppressAttachmentCaptureFor?.(suppressionMs);
        submitController.rememberProgrammaticSubmit(message.content);
        await adapter.composer.submit({ timeoutMs: submitTimeoutMs });
        await dependencies.logDebug({
          level: 'info',
          message: 'Prompt submit action dispatched',
          detail: `attachments=${message.attachments.length}`,
          workspaceId: message.workspaceId,
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
            const uploadError = message.attachments.length > 0
              ? await adapter.composer.detectAttachmentUploadError?.()
              : null;
            const reason = uploadError ?? (error instanceof Error ? error.message : String(error));
            await dependencies.logDebug({
              level: 'warn',
              message: 'Expected session ref update was not observed',
              detail: reason,
              workspaceId: message.workspaceId,
            });
            state.showCurrentWarning(getDeliveryWarningLabel(new Error(reason)));
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
          detail: `${error instanceof Error ? error.message : String(error)}; attachments=${message.attachments.length}`,
          workspaceId: message.workspaceId,
        });
        state.showCurrentWarning(getDeliveryWarningLabel(error));
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
