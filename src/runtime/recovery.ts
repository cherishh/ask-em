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
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const response = await pingContentTab(tabId);

    if (response?.provider === provider && response.pageState === 'ready') {
      return response;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return null;
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

export async function resolveDeliveryTarget(
  workspace: Workspace,
  provider: Provider,
  sessionState: SessionState,
): Promise<DeliveryTarget> {
  const claimedTab = getClaimedTab(sessionState, workspace.id, provider);
  const member = workspace.members[provider];
  const desiredUrl = member?.url ?? getSiteInfoByProvider(provider).origin;
  const expectedSessionId = member?.sessionId ?? null;

  if (claimedTab && !isClaimedTabStale(claimedTab)) {
    const ping = await pingContentTab(claimedTab.tabId);

    if (
      ping &&
      ping.pageState === 'ready' &&
      (!expectedSessionId || ping.sessionId === expectedSessionId)
    ) {
      return {
        tabId: claimedTab.tabId,
        expectedSessionId,
        expectedUrl: member?.url ?? null,
      };
    }

    if (member?.url) {
      const updatedTab = await navigateTab(claimedTab.tabId, member.url);

      if (updatedTab?.id) {
        await waitForTabLoad(updatedTab.id);
        await waitForContentReady(updatedTab.id, provider);
        return {
          tabId: updatedTab.id,
          expectedSessionId,
          expectedUrl: member.url,
        };
      }
    }
  }

  const createdTab = await openProviderTab(provider, desiredUrl);

  if (!createdTab.id) {
    throw new Error(`Unable to create tab for provider: ${provider}`);
  }

  await waitForTabLoad(createdTab.id);
  await waitForContentReady(createdTab.id, provider);

  return {
    tabId: createdTab.id,
    expectedSessionId,
    expectedUrl: member?.url ?? null,
  };
}
