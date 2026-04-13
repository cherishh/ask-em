import type { ClaimedTab, PingResponseMessage, Provider, SessionState } from '../runtime/protocol';
import { isTerminalRecoveryPageState } from './recovery-semantics';

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
    ).then((entries) =>
      entries.filter((entry): entry is readonly [string, ClaimedTab] => entry !== null),
    ),
  );

  return {
    sessionState: {
      ...sessionState,
      claimedTabs,
    },
    removedClaimedTabs,
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

      if (isTerminalRecoveryPageState(response.pageState)) {
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
