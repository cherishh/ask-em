import { getSessionState, getLocalState, setLocalState, setSessionState } from '../runtime/storage';
import { clearWorkspace } from '../runtime/workspace';
import { countClaimedTabsForWorkspace, removeClaimedTabsForWorkspace } from '../runtime/recovery';
import { logDebug } from './debug';

const AUTO_CLEAR_GROUP_DELAY_MS = 7_000;
const EMPTY_GROUP_DELETE_DELAY_MS = 2_000;
const pendingGroupGcTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function cancelScheduledGroupGc(workspaceId: string) {
  const timeoutId = pendingGroupGcTimers.get(workspaceId);
  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
    pendingGroupGcTimers.delete(workspaceId);
  }
}

export async function scheduleGroupGcIfEmpty(workspaceId: string) {
  cancelScheduledGroupGc(workspaceId);

  const sessionState = await getSessionState();
  if (countClaimedTabsForWorkspace(sessionState, workspaceId) > 0) {
    return;
  }

  const timeoutId = setTimeout(() => {
    pendingGroupGcTimers.delete(workspaceId);

    void (async () => {
      const [localState, latestSessionState] = await Promise.all([getLocalState(), getSessionState()]);
      if (!localState.workspaces[workspaceId]) {
        return;
      }

      if (countClaimedTabsForWorkspace(latestSessionState, workspaceId) > 0) {
        return;
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
    })();
  }, AUTO_CLEAR_GROUP_DELAY_MS);

  pendingGroupGcTimers.set(workspaceId, timeoutId);
}

export async function scheduleEmptyGroupDeletion(workspaceId: string) {
  cancelScheduledGroupGc(workspaceId);

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

  pendingGroupGcTimers.set(workspaceId, timeoutId);
}
