import { getSessionState, getLocalState, setLocalState, setSessionState } from '../runtime/storage';
import { clearWorkspace } from '../runtime/workspace';
import { countClaimedTabsForWorkspace, removeClaimedTabsForWorkspace } from './claimed-tabs';
import { logDebug } from './debug';
import { reconcileClaimedTabsWithBrowser } from './tab-runtime';

const AUTO_CLEAR_GROUP_DELAY_MS = 7_000;
const EMPTY_GROUP_DELETE_DELAY_MS = 2_000;
const pendingGroupGcTimers = new Map<string, ReturnType<typeof setTimeout>>();

function unrefTimer(timeoutId: ReturnType<typeof setTimeout>) {
  if (typeof timeoutId === 'object' && 'unref' in timeoutId) {
    timeoutId.unref();
  }
}

export async function cancelScheduledGroupGc(workspaceId: string) {
  const timeoutId = pendingGroupGcTimers.get(workspaceId);
  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
    pendingGroupGcTimers.delete(workspaceId);
  }
}

async function getReconciledSessionStateForGroupGc() {
  const sessionState = await getSessionState();
  if (typeof chrome === 'undefined' || !chrome.tabs?.get) {
    return sessionState;
  }

  const reconciliation = await reconcileClaimedTabsWithBrowser(sessionState);
  if (reconciliation.removedClaimedTabs.length > 0) {
    await setSessionState(reconciliation.sessionState);

    for (const claimedTab of reconciliation.removedClaimedTabs) {
      await logDebug({
        level: 'info',
        scope: 'background',
        workspaceId: claimedTab.workspaceId,
        provider: claimedTab.provider,
        message: 'Reconciled missing claimed tab before group cleanup',
      });
    }
  }

  return reconciliation.sessionState;
}

export async function clearGroupIfNoClaimedTabs(workspaceId: string): Promise<boolean> {
  await cancelScheduledGroupGc(workspaceId);

  const [localState, latestSessionState] = await Promise.all([
    getLocalState(),
    getReconciledSessionStateForGroupGc(),
  ]);
  if (!localState.workspaces[workspaceId]) {
    return false;
  }

  if (countClaimedTabsForWorkspace(latestSessionState, workspaceId) > 0) {
    return false;
  }

  await Promise.all([
    setLocalState(clearWorkspace(localState, workspaceId)),
    setSessionState(removeClaimedTabsForWorkspace(latestSessionState, workspaceId)),
  ]);
  await logDebug({
    level: 'info',
    scope: 'background',
    workspaceId,
    message: 'Auto-cleared group after all tabs closed',
  });
  return true;
}

export async function scheduleGroupGcIfEmpty(workspaceId: string) {
  await cancelScheduledGroupGc(workspaceId);

  const sessionState = await getReconciledSessionStateForGroupGc();
  if (countClaimedTabsForWorkspace(sessionState, workspaceId) > 0) {
    return;
  }

  const timeoutId = setTimeout(() => {
    pendingGroupGcTimers.delete(workspaceId);
    void clearGroupIfNoClaimedTabs(workspaceId);
  }, AUTO_CLEAR_GROUP_DELAY_MS);
  unrefTimer(timeoutId);
  pendingGroupGcTimers.set(workspaceId, timeoutId);
}

export async function scheduleEmptyGroupDeletion(workspaceId: string) {
  await cancelScheduledGroupGc(workspaceId);

  const timeoutId = setTimeout(() => {
    pendingGroupGcTimers.delete(workspaceId);

    void (async () => {
      const [localState, sessionState] = await Promise.all([getLocalState(), getSessionState()]);
      const workspace = localState.workspaces[workspaceId];

      if (!workspace) {
        return;
      }

      const hasVisibleProviders =
        workspace.enabledProviders.length > 0 || Object.keys(workspace.members).length > 0;
      if (hasVisibleProviders) {
        return;
      }

      await Promise.all([
        setLocalState(clearWorkspace(localState, workspaceId)),
        setSessionState(removeClaimedTabsForWorkspace(sessionState, workspaceId)),
      ]);
      await logDebug({
        level: 'info',
        scope: 'background',
        workspaceId,
        message: 'Deleted empty group after provider removal',
      });
    })();
  }, EMPTY_GROUP_DELETE_DELAY_MS);
  unrefTimer(timeoutId);

  pendingGroupGcTimers.set(workspaceId, timeoutId);
}
