import type { ProviderAdapter, UserSubmissionPayload } from '../adapters/types';
import {
  ATTACHMENT_CHUNK_BYTES,
  ATTACHMENT_MAX_COUNT,
  ATTACHMENT_MAX_FILE_BYTES,
  type AttachmentRef,
  type CapturedAttachment,
} from '../runtime/protocol';
import { formatAttachmentSummary, shortSubmitId } from '../runtime/attachment-log';
import { isProbablyPlainTextBytes } from '../runtime/attachment-text';
import { buildUserSubmitMessage, createSubmitId, sendRuntimeMessage } from './routing';
import type { ContentStateController, SubmitResponse } from './state';

type SubmitInput = string | UserSubmissionPayload;

function normalizeSubmitInput(input: SubmitInput): UserSubmissionPayload {
  if (typeof input === 'string') {
    return {
      text: input,
      attachments: [],
    };
  }

  return input;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const batchSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += batchSize) {
    const batch = bytes.subarray(offset, offset + batchSize);
    binary += String.fromCharCode(...batch);
  }

  return btoa(binary);
}

export function createSubmitController(
  adapter: ProviderAdapter,
  state: ContentStateController,
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
  const writeAttachmentsToStore = async (
    submitId: string,
    attachments: CapturedAttachment[],
  ): Promise<AttachmentRef[]> => {
    if (attachments.length === 0) {
      return [];
    }

    if (attachments.length > ATTACHMENT_MAX_COUNT) {
      throw new Error('too many files');
    }

    const refs: AttachmentRef[] = [];
    let createdAttachment = false;

    try {
      for (const attachment of attachments) {
        if (attachment.size > ATTACHMENT_MAX_FILE_BYTES) {
          throw new Error('attachment too large');
        }

        const bytes = new Uint8Array(await attachment.file.arrayBuffer());
        const ref: AttachmentRef = {
          id: attachment.id,
          name: attachment.name,
          mime: attachment.mime,
          size: attachment.size,
          isPlainText: isProbablyPlainTextBytes(bytes),
        };

        const createResponse = await sendRuntimeMessage<{ ok?: boolean; error?: string }>({
          type: 'ATTACHMENT_CREATE',
          submitId,
          ...ref,
        });
        if (!createResponse?.ok) {
          throw new Error(createResponse?.error ?? 'failed to create attachment');
        }
        createdAttachment = true;

        for (let offset = 0; offset < bytes.byteLength; offset += ATTACHMENT_CHUNK_BYTES) {
          const chunk = bytes.subarray(offset, Math.min(offset + ATTACHMENT_CHUNK_BYTES, bytes.byteLength));
          const appendResponse = await sendRuntimeMessage<{ ok?: boolean; error?: string }>({
            type: 'ATTACHMENT_APPEND_CHUNK',
            submitId,
            attachmentId: attachment.id,
            offset,
            chunkBase64: bytesToBase64(chunk),
          });
          if (!appendResponse?.ok) {
            throw new Error(appendResponse?.error ?? 'failed to append attachment');
          }
        }

        const finalizeResponse = await sendRuntimeMessage<{ ok?: boolean; ref?: AttachmentRef; error?: string }>({
          type: 'ATTACHMENT_FINALIZE',
          submitId,
          attachmentId: attachment.id,
        });
        if (!finalizeResponse?.ok || !finalizeResponse.ref) {
          throw new Error(finalizeResponse?.error ?? 'failed to finalize attachment');
        }

        refs.push(finalizeResponse.ref);
      }

      return refs;
    } catch (error) {
      if (createdAttachment) {
        await sendRuntimeMessage({
          type: 'ATTACHMENT_ABORT',
          submitId,
        });
      }
      throw error;
    }
  };

  const reportUserSubmit = async (input: SubmitInput) => {
    const payload = normalizeSubmitInput(input);
    const content = payload.text.trim();
    if ((!content && payload.attachments.length === 0) || state.isSubmissionSuppressed()) {
      return;
    }

    let status = adapter.session.getStatus();
    if (status.pageKind === 'new-chat' && !state.hasHydratedPresence()) {
      await dependencies.reportPresence('HELLO');
      status = adapter.session.getStatus();
    }

    if (state.shouldSuppressProgrammaticSubmit(content)) {
      await dependencies.logDebug({
        level: 'info',
        message: 'Skipped programmatic submit echo',
        detail: content.slice(0, 120),
      });
      return;
    }

    const attachmentIds = payload.attachments.map((attachment) => attachment.id).sort();
    const fingerprint = attachmentIds.length > 0
      ? `${status.currentUrl}::${content}::${attachmentIds.join(',')}`
      : `${status.currentUrl}::${content}`;

    if (state.shouldSkipDuplicateSubmit(fingerprint)) {
      return;
    }

    state.rememberSubmitFingerprint(fingerprint);

    if (status.pageState !== 'ready') {
      state.applyIndicatorPresentation(status);
      await dependencies.logDebug({
        level: 'info',
        message: 'Skipped submit because current page is not sync-eligible',
        detail: `${status.pageState} (${status.pageKind}) @ ${status.currentUrl}${status.authRule ? ` [rule=${status.authRule}; signals=${status.authSignalSummary ?? 'none'}]` : ''}: ${content.slice(0, 120)}`,
      });
      payload.onConsumed?.();
      return;
    }

    const uiContext = state.getUiContext();
    if (
      !uiContext.workspaceId &&
      status.pageKind === 'new-chat' &&
      status.sessionId === null &&
      !uiContext.standaloneCreateSetEnabled
    ) {
      state.applyIndicatorPresentation(status);
      await dependencies.logDebug({
        level: 'info',
        message: 'Skipped new set creation for standalone chat',
        detail: content.slice(0, 120),
      });
      payload.onConsumed?.();
      return;
    }

    await dependencies.logDebug({
      level: 'info',
      message: 'Detected user submit',
      detail: `${content.slice(0, 120)}; attachments=${payload.attachments.length}${payload.attachmentResolution ? `; captured=${payload.attachmentResolution.capturedCount}; current=${payload.attachmentResolution.currentCount ?? 'unknown'}` : ''}`,
    });

    state.setSyncing();

    const submitId = createSubmitId();
    let attachments: AttachmentRef[] = [];

    if (
      payload.attachmentResolution &&
      payload.attachmentResolution.capturedCount > 0 &&
      payload.attachmentResolution.submittedCount === 0 &&
      payload.attachmentResolution.reason &&
      payload.attachmentResolution.reason !== 'no-current-attachments'
    ) {
      state.showCurrentWarning('attachment sync skipped');
      if (payload.attachmentResolution.reason === 'ambiguous-current-attachments') {
        state.showToast('Attachment sync skipped: duplicate filenames are ambiguous.', 'warning');
      }
      await dependencies.logDebug({
        level: 'warn',
        message: 'Skipped source attachments before staging',
        detail: `submit=${shortSubmitId(submitId)}; captured=${payload.attachmentResolution.capturedCount}; current=${payload.attachmentResolution.currentCount ?? 'unknown'}; reason=${payload.attachmentResolution.reason}`,
      });
    }

    try {
      if (payload.attachments.length > 0) {
        await dependencies.logDebug({
          level: 'info',
          message: 'Staging submit attachments',
          detail: `submit=${shortSubmitId(submitId)}; ${formatAttachmentSummary(payload.attachments)}`,
        });
      }

      attachments = await writeAttachmentsToStore(submitId, payload.attachments);

      if (attachments.length > 0) {
        await dependencies.logDebug({
          level: 'info',
          message: 'Submit attachments ready',
          detail: `submit=${shortSubmitId(submitId)}; ${formatAttachmentSummary(attachments)}`,
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      state.showCurrentWarning(
        error instanceof Error && reason === 'too many files'
          ? 'too many files'
          : error instanceof Error && reason.includes('large')
            ? 'attachment too large'
            : 'attachment sync skipped',
      );
      await dependencies.logDebug({
        level: 'warn',
        message: 'Skipped attachment fan-out',
        detail: `submit=${shortSubmitId(submitId)}; ${formatAttachmentSummary(payload.attachments)}; reason=${reason}`,
      });
      attachments = [];
    } finally {
      payload.onConsumed?.();
    }

    const response = await sendRuntimeMessage<SubmitResponse>(
      buildUserSubmitMessage(status, content, uiContext.standaloneCreateSetEnabled, {
        attachments,
        submitId,
      }),
      {
        onError(error) {
          console.warn('ask-em: failed to report user submit', error);
        },
      },
    );
    state.applySubmitResponse(response);
    state.applyIndicatorPresentation();
  };

  return {
    reportUserSubmit,
    suppressObservedSubmissionsFor(durationMs: number) {
      state.suppressObservedSubmissions(durationMs);
    },
    rememberProgrammaticSubmit(content: string) {
      state.rememberProgrammaticSubmit(content);
    },
  };
}

export type ContentSubmitController = ReturnType<typeof createSubmitController>;
