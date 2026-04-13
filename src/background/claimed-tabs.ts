import { HEARTBEAT_STALE_MS, toClaimedTabKey, type ClaimedTab, type Provider, type SessionState } from '../runtime/protocol';

export function getClaimedTab(
  sessionState: SessionState,
  workspaceId: string,
  provider: Provider,
): ClaimedTab | null {
  return sessionState.claimedTabs[toClaimedTabKey(workspaceId, provider)] ?? null;
}

export function getClaimedTabByTabId(
  sessionState: SessionState,
  tabId: number,
  provider: Provider,
): ClaimedTab | null {
  return (
    Object.values(sessionState.claimedTabs).find(
      (claimedTab) => claimedTab.tabId === tabId && claimedTab.provider === provider,
    ) ?? null
  );
}

export function isClaimedTabStale(
  claimedTab: ClaimedTab,
  now = Date.now(),
  staleMs = HEARTBEAT_STALE_MS,
): boolean {
  return now - claimedTab.lastSeenAt > staleMs;
}

export function removeClaimedTabsForWorkspace(
  sessionState: SessionState,
  workspaceId: string,
): SessionState {
  const claimedTabs = Object.fromEntries(
    Object.entries(sessionState.claimedTabs).filter(([key]) => !key.startsWith(`${workspaceId}:`)),
  );

  return {
    ...sessionState,
    claimedTabs,
  };
}

export function removeClaimedTabsForTabId(
  sessionState: SessionState,
  tabId: number,
): {
  sessionState: SessionState;
  removedClaimedTabs: ClaimedTab[];
} {
  const removedClaimedTabs: ClaimedTab[] = [];
  const claimedTabs = Object.fromEntries(
    Object.entries(sessionState.claimedTabs).filter(([, claimedTab]) => {
      if (claimedTab.tabId === tabId) {
        removedClaimedTabs.push(claimedTab);
        return false;
      }

      return true;
    }),
  );

  return {
    sessionState: {
      ...sessionState,
      claimedTabs,
    },
    removedClaimedTabs,
  };
}

export function countClaimedTabsForWorkspace(
  sessionState: SessionState,
  workspaceId: string,
): number {
  return Object.values(sessionState.claimedTabs).filter(
    (claimedTab) => claimedTab.workspaceId === workspaceId,
  ).length;
}
