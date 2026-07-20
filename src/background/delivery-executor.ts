import {
  getProviderDeliveryAttachments,
  type Provider,
  type ProviderDeliveryResult,
  type SessionState,
  type UserSubmitMessage,
  type Workspace,
} from '../runtime/protocol';
import { upsertClaimedTab } from '../runtime/storage';
import { formatAttachmentSummary } from '../runtime/attachment-log';
import { logDebug } from './debug';
import { checkProviderAttachmentCapability } from './attachment-capability';
import { resolveDeliveryTarget, resolveReadyProviderTabForWorkspace } from './delivery-targets';

type DeliverPromptResponse = {
  ok?: boolean;
  accepted?: boolean;
  confirmed?: boolean;
  blocked?: boolean;
  error?: string;
  diagnostic?: string;
};

type AttemptProviderDeliveryInput = {
  workspace: Workspace;
  workspaceId: string;
  provider: Provider;
  message: UserSubmitMessage;
  sessionState: SessionState;
};

function getFailedDeliveryPayloadReason(payload: DeliverPromptResponse | undefined): string {
  return (
    payload?.error ??
    (payload?.confirmed === false
      ? 'Prompt delivery was not confirmed'
      : payload?.blocked
        ? 'Prompt delivery blocked'
        : 'Prompt delivery failed')
  );
}

async function logFailedDeliveryPayload(
  workspaceId: string,
  provider: Provider,
  payload: DeliverPromptResponse | undefined,
  skippedAttachmentCount = 0,
) {
  const reason = getFailedDeliveryPayloadReason(payload);
  const detail = payload?.diagnostic ? `${reason}; ${payload.diagnostic}` : reason;

  await logDebug({
    level: payload?.blocked || payload?.confirmed === false ? 'warn' : 'error',
    scope: 'background',
    provider,
    workspaceId,
    message: payload?.confirmed === false
      ? 'Prompt delivery confirmation failed'
      : payload?.blocked
        ? 'Prompt delivery blocked'
        : 'Prompt delivery failed',
    detail,
  });

  return {
    provider,
    ok: false,
    accepted: payload?.accepted,
    confirmed: payload?.confirmed,
    blocked: payload?.blocked,
    reason,
    skippedAttachmentCount:
      skippedAttachmentCount > 0 ? skippedAttachmentCount : undefined,
  } satisfies ProviderDeliveryResult;
}

export async function attemptProviderDelivery({
  workspace,
  workspaceId,
  provider,
  message,
  sessionState,
}: AttemptProviderDeliveryInput): Promise<ProviderDeliveryResult> {
  const existingIssue = workspace.memberIssues?.[provider] ?? null;
  let deliveryTargetOverride: Awaited<ReturnType<typeof resolveReadyProviderTabForWorkspace>> = null;
  const deliveryAttachments = getProviderDeliveryAttachments(
    provider,
    message.attachments,
  );
  const skippedAttachmentCount =
    message.attachments.length - deliveryAttachments.length;
  const attachmentCapability = checkProviderAttachmentCapability(
    provider,
    deliveryAttachments,
  );

  if (!attachmentCapability.ok) {
    await logDebug({
      level: 'warn',
      scope: 'background',
      provider,
      workspaceId,
      message: 'Skipped delivery for unsupported attachment',
      detail: `${attachmentCapability.reason}; ${formatAttachmentSummary(deliveryAttachments)}`,
    });

    return {
      provider,
      ok: false,
      reason: attachmentCapability.reason,
    } satisfies ProviderDeliveryResult;
  }

  if (
    skippedAttachmentCount > 0 &&
    deliveryAttachments.length === 0 &&
    message.content.trim().length === 0
  ) {
    await logDebug({
      level: 'info',
      scope: 'background',
      provider,
      workspaceId,
      message: 'Skipped empty prompt for prompt-only provider',
      detail: `Skipped ${skippedAttachmentCount} attachments`,
    });

    return {
      provider,
      ok: true,
      skippedAttachmentCount,
    } satisfies ProviderDeliveryResult;
  }

  if (existingIssue === 'needs-login') {
    deliveryTargetOverride = await resolveReadyProviderTabForWorkspace(
      workspace,
      provider,
      sessionState,
    );

    if (!deliveryTargetOverride) {
      const reason = `${provider} login required`;
      await logDebug({
        level: 'info',
        scope: 'background',
        provider,
        workspaceId,
        message: 'Skipped delivery for provider with known login issue',
        detail: reason,
      });

      return {
        provider,
        ok: false,
        reason,
        skippedAttachmentCount:
          skippedAttachmentCount > 0 ? skippedAttachmentCount : undefined,
      } satisfies ProviderDeliveryResult;
    }

    await logDebug({
      level: 'info',
      scope: 'background',
      provider,
      workspaceId,
      message: 'Recovered delivery target from ready tab after login issue',
      detail: deliveryTargetOverride.reason,
    });
  }

  try {
    const target = deliveryTargetOverride ?? (await resolveDeliveryTarget(workspace, provider, sessionState));
    await upsertClaimedTab(workspaceId, provider, {
      provider,
      workspaceId,
      tabId: target.tabId,
      lastSeenAt: Date.now(),
      pageState: 'not-ready',
      currentUrl: target.expectedUrl ?? '',
      sessionId: target.expectedSessionId,
    });

    await logDebug({
      level: 'info',
      scope: 'background',
      provider,
      workspaceId,
      message: 'Resolved delivery target',
      detail: `${target.resolution}: ${target.reason}`,
    });

    await logDebug({
      level: 'info',
      scope: 'background',
      provider,
      workspaceId,
      message: 'Delivering prompt',
      detail: `${message.provider} -> ${provider} @ ${target.expectedSessionId ?? 'new-chat'}; ${formatAttachmentSummary(deliveryAttachments)}`,
    });

    const response = (await chrome.tabs.sendMessage(target.tabId, {
      type: 'DELIVER_PROMPT',
      workspaceId,
      provider,
      content: message.content,
      attachments: deliveryAttachments,
      expectedSessionId: target.expectedSessionId,
      expectedUrl: target.expectedUrl,
      timestamp: Date.now(),
    })) as DeliverPromptResponse | undefined;

    if (response?.accepted) {
      await logDebug({
        level: 'info',
        scope: 'background',
        provider,
        workspaceId,
        message: 'Prompt delivery accepted',
        detail: `${message.provider} -> ${provider}; attachments=${deliveryAttachments.length}`,
      });
    }

    if (!response?.ok || response?.confirmed === false) {
      return logFailedDeliveryPayload(
        workspaceId,
        provider,
        response,
        skippedAttachmentCount,
      );
    }

    await logDebug({
      level: 'info',
      scope: 'background',
      provider,
      workspaceId,
      message: 'Prompt delivery confirmed',
      detail: `${message.provider} -> ${provider}; attachments=${deliveryAttachments.length}`,
    });

    return {
      provider,
      ok: true,
      accepted: response?.accepted,
      confirmed: response?.confirmed,
      skippedAttachmentCount:
        skippedAttachmentCount > 0 ? skippedAttachmentCount : undefined,
    } satisfies ProviderDeliveryResult;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const isLoginRequired = reason.toLowerCase().includes('login required');
    await logDebug({
      level: isLoginRequired ? 'warn' : 'error',
      scope: 'background',
      provider,
      workspaceId,
      message: isLoginRequired ? 'Prompt delivery login required' : 'Prompt delivery threw',
      detail: reason,
    });

    return {
      provider,
      ok: false,
      reason,
      skippedAttachmentCount:
        skippedAttachmentCount > 0 ? skippedAttachmentCount : undefined,
    } satisfies ProviderDeliveryResult;
  }
}
