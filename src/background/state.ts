import { getLocalState, getSessionState, setLocalState, setSessionState } from '../runtime/storage';
import { cleanupPendingWorkspaces } from '../runtime/workspace';
import { reconcileClaimedTabsWithBrowser } from '../runtime/recovery';
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
  }

  return {
    localState: cleanupResult.localState,
    sessionState: reconciliation.sessionState,
  };
}
