import type { ProviderAdapter, UserSubmissionPayload } from '../adapters/types';
import {
  type AttachmentRef,
  type Provider,
  type ProviderDeliveryResult,
  PROVIDER_UPLOAD_CAPABILITIES,
} from '../runtime/protocol';
import { formatAttachmentSummary, shortSubmitId } from '../runtime/attachment-log';
import { buildUserSubmitMessage, createSubmitId, sendRuntimeMessage } from './routing';
import { stageSubmitAttachments } from './attachment-staging';
import type { ContentStateController, SubmitResponse } from './state';

type SubmitInput = string | UserSubmissionPayload;

const PROVIDER_LABELS: Record<Provider, string> = {
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  manus: 'Manus',
};

function normalizeSubmitInput(input: SubmitInput): UserSubmissionPayload {
  if (typeof input === 'string') {
    return {
      text: input,
      attachments: [],
    };
  }

  return input;
}

function formatFileCount(count: number): string {
  return `${count} ${count === 1 ? 'file' : 'files'}`;
}

function buildAttachmentLimitToast(
  deliveryResults: ProviderDeliveryResult[] | undefined,
  attachmentCount: number,
): string | null {
  const limitedResults = (deliveryResults ?? []).filter((result) =>
    !result.ok && result.reason?.toLowerCase().includes('attachment count not supported'),
  );

  if (limitedResults.length === 0) {
    return null;
  }

  const providerLabels = limitedResults.map((result) => PROVIDER_LABELS[result.provider]);
  const skippedPrefix = providerLabels.length === 1
    ? `${providerLabels[0]} skipped`
    : `${providerLabels.join(', ')} skipped`;
  const successSuffix = (deliveryResults ?? []).some((result) => result.ok)
    ? ' Other providers synced.'
    : '';

  if (limitedResults.length === 1) {
    const provider = limitedResults[0].provider;
    const maxFiles = PROVIDER_UPLOAD_CAPABILITIES[provider]?.maxFiles;
    const limitDetail = maxFiles
      ? `${PROVIDER_LABELS[provider]} supports ${formatFileCount(maxFiles)}`
      : `${PROVIDER_LABELS[provider]} supports fewer files`;

    return `${skippedPrefix}: this prompt has ${formatFileCount(attachmentCount)}; ${limitDetail}.${successSuffix}`;
  }

  return `${skippedPrefix}: this prompt has ${formatFileCount(attachmentCount)}; those models support fewer files.${successSuffix}`;
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
      (!uiContext.standaloneCreateSetEnabled || uiContext.standaloneFanOutTargetCount === 0)
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
        state.showToast('Attachment sync skipped: current files could not be confirmed.', 'warning');
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

      attachments = await stageSubmitAttachments(submitId, payload.attachments);

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
    const attachmentLimitToast = buildAttachmentLimitToast(response?.deliveryResults, attachments.length);
    if (attachmentLimitToast) {
      state.showToast(attachmentLimitToast, 'warning');
    }
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
