import type { SyncProgressMessage } from '../runtime/protocol';
import type { getSessionState } from '../runtime/storage';

export async function notifyTabsToRefreshContext(tabIds: number[]) {
  await Promise.allSettled(
    Array.from(new Set(tabIds)).map(async (tabId) => {
      await chrome.tabs.sendMessage(tabId, {
        type: 'REFRESH_CONTENT_CONTEXT',
      });
    }),
  );
}

export async function notifySyncProgress(tabId: number, progress: SyncProgressMessage) {
  try {
    await chrome.tabs.sendMessage(tabId, progress);
  } catch {
    // Ignore source-tab progress update failures. The final submit response still carries the terminal state.
  }
}

export function getClaimedTabIdsForWorkspace(
  sessionState: Awaited<ReturnType<typeof getSessionState>>,
  workspaceId: string,
) {
  return Object.values(sessionState.claimedTabs)
    .filter((claimedTab) => claimedTab.workspaceId === workspaceId)
    .map((claimedTab) => claimedTab.tabId);
}

export async function notifyAllTabsToRefreshContext() {
  const tabs: chrome.tabs.Tab[] = await chrome.tabs.query({});
  await notifyTabsToRefreshContext(
    tabs.map((tab) => tab.id).filter((tabId): tabId is number => typeof tabId === 'number'),
  );
}

export async function notifyAllTabsToResetIndicatorPosition() {
  const tabs: chrome.tabs.Tab[] = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs
      .map((tab) => tab.id)
      .filter((tabId): tabId is number => typeof tabId === 'number')
      .map(async (tabId) => {
        await chrome.tabs.sendMessage(tabId, {
          type: 'RESET_INDICATOR_POSITION',
        });
      }),
  );
}
