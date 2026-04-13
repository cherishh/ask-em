import type { Provider, ProviderDeliveryResult } from '../runtime/protocol';
import { notifySyncProgress } from './tabs';

export async function notifyInitialSyncProgress(
  sourceTabId: number | undefined,
  workspaceId: string,
  total: number,
) {
  if (!sourceTabId || total === 0) {
    return;
  }

  await notifySyncProgress(sourceTabId, {
    type: 'SYNC_PROGRESS',
    workspaceId,
    total,
    completed: 0,
    succeeded: 0,
    failed: 0,
  });
}

export function createSyncProgressTracker(
  sourceTabId: number | undefined,
  workspaceId: string,
  total: number,
) {
  let completed = 0;
  let succeeded = 0;
  let failed = 0;

  return {
    async record(result: ProviderDeliveryResult) {
      completed += 1;
      if (result.ok) {
        succeeded += 1;
      } else {
        failed += 1;
      }

      if (!sourceTabId) {
        return;
      }

      await notifySyncProgress(sourceTabId, {
        type: 'SYNC_PROGRESS',
        workspaceId,
        total,
        completed,
        succeeded,
        failed,
      });
    },
  };
}

export function normalizeSettledDeliveryResults(
  providers: Provider[],
  settledResults: PromiseSettledResult<ProviderDeliveryResult>[],
): ProviderDeliveryResult[] {
  return settledResults.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }

    const provider = providers[index];
    return {
      provider,
      ok: false,
      reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
    } satisfies ProviderDeliveryResult;
  });
}
