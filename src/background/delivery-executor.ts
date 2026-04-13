import type {
  Provider,
  ProviderDeliveryResult,
  SessionState,
  UserSubmitMessage,
  Workspace,
} from '../runtime/protocol';
import { upsertClaimedTab } from '../runtime/storage';
import { logDebug } from './debug';
import { resolveDeliveryTarget, resolveReadyProviderTabForWorkspace } from './delivery-targets';

type DeliverPromptResponse = {
  ok?: boolean;
  accepted?: boolean;
  confirmed?: boolean;
  blocked?: boolean;
  error?: string;
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
) {
  const reason = getFailedDeliveryPayloadReason(payload);

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
    detail: reason,
  });

  return {
    provider,
    ok: false,
    accepted: payload?.accepted,
    confirmed: payload?.confirmed,
    blocked: payload?.blocked,
    reason,
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
      detail: `${message.provider} -> ${provider} @ ${target.expectedSessionId ?? 'new-chat'}`,
    });

    const response = (await chrome.tabs.sendMessage(target.tabId, {
      type: 'DELIVER_PROMPT',
      workspaceId,
      provider,
      content: message.content,
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
        detail: `${message.provider} -> ${provider}`,
      });
    }

    if (!response?.ok || response?.confirmed === false) {
      return logFailedDeliveryPayload(workspaceId, provider, response);
    }

    await logDebug({
      level: 'info',
      scope: 'background',
      provider,
      workspaceId,
      message: 'Prompt delivery confirmed',
      detail: `${message.provider} -> ${provider}`,
    });

    return {
      provider,
      ok: true,
      accepted: response?.accepted,
      confirmed: response?.confirmed,
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
    } satisfies ProviderDeliveryResult;
  }
}
