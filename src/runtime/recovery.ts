import { getSiteInfoByProvider } from '../adapters/sites';
import {
  HEARTBEAT_STALE_MS,
  toClaimedTabKey,
  type ClaimedTab,
  type PingResponseMessage,
  type Provider,
  type SessionState,
  type Workspace,
} from './protocol';

export type DeliveryTarget = {
  tabId: number;
  expectedSessionId: string | null;
  expectedUrl: string | null;
  resolution: 'reuse-claimed-tab' | 'navigate-claimed-tab' | 'open-new-tab';
  reason: string;
};

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

export async function reconcileClaimedTabsWithBrowser(
  sessionState: SessionState,
): Promise<{
  sessionState: SessionState;
  removedClaimedTabs: ClaimedTab[];
}> {
  const removedClaimedTabs: ClaimedTab[] = [];
  const claimedTabs = Object.fromEntries(
    await Promise.all(
      Object.entries(sessionState.claimedTabs).map(async ([key, claimedTab]) => {
        try {
          await chrome.tabs.get(claimedTab.tabId);
          return [key, claimedTab] as const;
        } catch {
          removedClaimedTabs.push(claimedTab);
          return null;
        }
      }),
    ).then((entries) => entries.filter((entry): entry is readonly [string, ClaimedTab] => entry !== null)),
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

export async function pingContentTab(tabId: number): Promise<PingResponseMessage | null> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return response as PingResponseMessage;
  } catch {
    return null;
  }
}

export async function waitForContentReady(
  tabId: number,
  provider: Provider,
  timeoutMs = 15_000,
): Promise<PingResponseMessage | null> {
  const response = await waitForContentStatus(tabId, provider, timeoutMs);
  return response?.pageState === 'ready' ? response : null;
}

export async function waitForContentStatus(
  tabId: number,
  provider: Provider,
  timeoutMs = 15_000,
): Promise<PingResponseMessage | null> {
  const startedAt = Date.now();
  let latestResponse: PingResponseMessage | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    const response = await pingContentTab(tabId);

    if (response?.provider === provider) {
      latestResponse = response;

      if (response.pageState === 'ready' || response.pageState === 'login-required') {
        return response;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return latestResponse;
}

export async function waitForTabLoad(tabId: number, timeoutMs = 15_000): Promise<boolean> {
  const current = await chrome.tabs.get(tabId);
  if (current.status === 'complete') {
    return true;
  }

  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(false);
    }, timeoutMs);

    const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(true);
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function openProviderTab(provider: Provider, url?: string): Promise<chrome.tabs.Tab> {
  return chrome.tabs.create({
    url: url ?? getSiteInfoByProvider(provider).origin,
    active: false,
  });
}

async function navigateTab(tabId: number, url: string): Promise<chrome.tabs.Tab | null> {
  try {
    const updatedTab = await chrome.tabs.update(tabId, { url, active: false });
    return updatedTab ?? null;
  } catch {
    return null;
  }
}

function assertDeliverableStatus(
  provider: Provider,
  status: PingResponseMessage | null,
  expectedSessionId: string | null,
): asserts status is PingResponseMessage {
  if (!status) {
    throw new Error(`${provider} not ready`);
  }

  if (status.pageState === 'login-required') {
    throw new Error(`${provider} login required`);
  }

  if (status.pageState !== 'ready') {
    throw new Error(`${provider} not ready`);
  }

  if (expectedSessionId && status.sessionId !== expectedSessionId) {
    throw new Error(`${provider} session mismatch`);
  }
}

export async function resolveDeliveryTarget(
  workspace: Workspace,
  provider: Provider,
  sessionState: SessionState,
): Promise<DeliveryTarget> {
  const claimedTab = getClaimedTab(sessionState, workspace.id, provider);
  const member = workspace.members[provider];
  const desiredUrl = member?.url ?? getSiteInfoByProvider(provider).origin;
  const expectedSessionId = member?.sessionId ?? null;

  if (claimedTab) {
    const stale = isClaimedTabStale(claimedTab);
    const ping = await pingContentTab(claimedTab.tabId);

    if (ping?.provider === provider && ping.pageState === 'login-required') {
      throw new Error(`${provider} login required`);
    }

    if (
      ping &&
      ping.pageState === 'ready' &&
      (!expectedSessionId || ping.sessionId === expectedSessionId)
    ) {
      return {
        tabId: claimedTab.tabId,
        expectedSessionId,
        expectedUrl: member?.url ?? null,
        resolution: 'reuse-claimed-tab',
        reason: ping.sessionId
          ? `${stale ? 'stale ' : ''}claimed tab responded ready with matching session ${ping.sessionId}`
          : `${stale ? 'stale ' : ''}claimed tab responded ready without a bound session yet`,
      };
    }

    if (member?.url) {
      const updatedTab = await navigateTab(claimedTab.tabId, member.url);

      if (updatedTab?.id) {
        await waitForTabLoad(updatedTab.id);
        const status = await waitForContentStatus(updatedTab.id, provider);
        assertDeliverableStatus(provider, status, expectedSessionId);
        return {
          tabId: updatedTab.id,
          expectedSessionId,
          expectedUrl: member.url,
          resolution: 'navigate-claimed-tab',
          reason: ping
            ? `${stale ? 'stale ' : ''}claimed tab ping mismatch or not-ready (pageState=${ping.pageState}, sessionId=${ping.sessionId ?? 'null'})`
            : `${stale ? 'stale ' : ''}claimed tab did not respond to ping; navigated claimed tab back to bound URL`,
        };
      }
    }
  }

  const createdTab = await openProviderTab(provider, desiredUrl);

  if (!createdTab.id) {
    throw new Error(`Unable to create tab for provider: ${provider}`);
  }

  await waitForTabLoad(createdTab.id);
  const status = await waitForContentStatus(createdTab.id, provider);
  assertDeliverableStatus(provider, status, expectedSessionId);

  return {
    tabId: createdTab.id,
    expectedSessionId,
    expectedUrl: member?.url ?? null,
    resolution: 'open-new-tab',
    reason: claimedTab
      ? isClaimedTabStale(claimedTab)
        ? `claimed tab ${claimedTab.tabId} considered stale`
        : member?.url
          ? `claimed tab ${claimedTab.tabId} could not be recovered via navigation`
          : `claimed tab ${claimedTab.tabId} was unsuitable and no bound URL was available`
      : 'no claimed tab was available for this provider',
  };
}
