import type { Provider, ProviderDeliveryResult, WorkspaceSummary } from '../runtime/protocol';
import { logDebug } from './debug';

export type UserSubmitResult = {
  ok: true;
  synced: boolean;
  workspaceId: string | null;
  providerEnabled?: boolean;
  globalSyncEnabled: boolean;
  canStartNewSet: boolean;
  deliveryResults?: ProviderDeliveryResult[];
  workspaceSummary: WorkspaceSummary | null;
};

type BuildUserSubmitResultInput = {
  synced: boolean;
  workspaceId: string | null;
  globalSyncEnabled: boolean;
  canStartNewSet: boolean;
  workspaceSummary: WorkspaceSummary | null;
  providerEnabled?: boolean;
  deliveryResults?: ProviderDeliveryResult[];
};

export function buildUserSubmitResult(input: BuildUserSubmitResultInput): UserSubmitResult {
  return {
    ok: true,
    synced: input.synced,
    workspaceId: input.workspaceId,
    providerEnabled: input.providerEnabled,
    globalSyncEnabled: input.globalSyncEnabled,
    canStartNewSet: input.canStartNewSet,
    deliveryResults: input.deliveryResults,
    workspaceSummary: input.workspaceSummary,
  };
}

export async function logFanOutCompletion(
  provider: Provider,
  workspaceId: string,
  enabledProviders: Provider[],
  deliveryResults: ProviderDeliveryResult[],
) {
  if (deliveryResults.length === 0) {
    await logDebug({
      level: 'info',
      scope: 'background',
      provider,
      workspaceId,
      message: 'No sync fan-out targets',
      detail: enabledProviders.join(', '),
    });
    return;
  }

  const succeeded = deliveryResults.filter((result) => result.ok);
  const failed = deliveryResults.filter((result) => !result.ok);

  await logDebug({
    level: failed.length > 0 ? 'warn' : 'info',
    scope: 'background',
    provider,
    workspaceId,
    message: 'Sync fan-out completed',
    detail: failed.length > 0
      ? `${succeeded.length}/${deliveryResults.length} ok; failed: ${failed
          .map((result) => `${result.provider}${result.reason ? ` (${result.reason})` : ''}`)
          .join(', ')}`
      : `${succeeded.length}/${deliveryResults.length} ok`,
  });
}
