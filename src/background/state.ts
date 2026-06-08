import { getLocalState, getSessionState, setLocalState, setSessionState } from '../runtime/storage';
import { cleanupPendingWorkspaces } from '../runtime/workspace';
import { reconcileClaimedTabsWithBrowser } from './tab-runtime';
import { scheduleGroupGcIfEmpty } from './gc';
import { logDebug } from './debug';

export async function refreshPendingState() {
  const [localState, rawSessionState] = await Promise.all([getLocalState(), getSessionState()]);
  const reconciliation = await reconcileClaimedTabsWithBrowser(rawSessionState);
  const cleanupResult = cleanupPendingWorkspaces(localState, reconciliation.sessionState);

  if (reconciliation.removedClaimedTabs.length > 0) {
    await setSessionState(reconciliation.sessionState);

    for (const claimedTab of reconciliation.removedClaimedTabs) {
      await logDebug({
        level: 'info',
        scope: 'background',
        workspaceId: claimedTab.workspaceId,
        provider: claimedTab.provider,
        message: 'Reconciled missing claimed tab',
      });
      await scheduleGroupGcIfEmpty(claimedTab.workspaceId);
    }
  }

  if (cleanupResult.removedWorkspaceIds.length > 0) {
    await setLocalState(cleanupResult.localState);

    for (const removedWorkspace of cleanupResult.removedWorkspaces) {
      await logDebug({
        level: 'warn',
        scope: 'background',
        workspaceId: removedWorkspace.workspaceId,
        provider: removedWorkspace.pendingSource,
        message: 'Cleaned pending workspace',
        detail: [
          `reason=${removedWorkspace.reason}`,
          `ageMs=${removedWorkspace.ageMs}`,
          `hasClaimedSourceTab=${removedWorkspace.hasClaimedSourceTab}`,
          `hasBoundTargets=${removedWorkspace.hasBoundTargets}`,
        ].join('; '),
      });
    }
  }

  return {
    localState: cleanupResult.localState,
    sessionState: reconciliation.sessionState,
  };
}
