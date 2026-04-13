import { getSiteInfo, getSiteInfoByProvider } from '../adapters/sites';
import type { PingResponseMessage, Provider, SessionState, Workspace } from '../runtime/protocol';
import { getClaimedTab, getClaimedTabByTabId, isClaimedTabStale } from './claimed-tabs';
import { getRecoveryStatusError } from './recovery-semantics';
import { pingContentTab, waitForContentStatus, waitForTabLoad } from './tab-runtime';

export type DeliveryTarget = {
  tabId: number;
  expectedSessionId: string | null;
  expectedUrl: string | null;
  resolution: 'reuse-claimed-tab' | 'navigate-claimed-tab' | 'open-new-tab' | 'reuse-ready-tab';
  reason: string;
};

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
  const recoveryError = getRecoveryStatusError(provider, status);
  if (recoveryError) {
    throw new Error(recoveryError);
  }

  if (!status || status.pageState !== 'ready') {
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

export async function resolveReadyProviderTabForWorkspace(
  workspace: Workspace,
  provider: Provider,
  sessionState: SessionState,
): Promise<DeliveryTarget | null> {
  const member = workspace.members[provider];
  const expectedSessionId = member?.sessionId ?? null;
  const site = getSiteInfoByProvider(provider);
  const tabs = await chrome.tabs.query({});

  for (const tab of tabs) {
    if (!tab.id || !tab.url) {
      continue;
    }

    if (getSiteInfo(tab.url)?.name !== provider) {
      continue;
    }

    const claimedTab = getClaimedTabByTabId(sessionState, tab.id, provider);
    if (claimedTab && claimedTab.workspaceId !== workspace.id) {
      continue;
    }

    const ping = await pingContentTab(tab.id);
    if (!ping || ping.provider !== provider || ping.pageState !== 'ready') {
      continue;
    }

    if (expectedSessionId) {
      if (ping.sessionId !== expectedSessionId) {
        continue;
      }
    } else if (!site.isBlankChatUrl(ping.currentUrl)) {
      continue;
    }

    return {
      tabId: tab.id,
      expectedSessionId,
      expectedUrl: member?.url ?? null,
      resolution: 'reuse-ready-tab',
      reason: expectedSessionId
        ? `ready tab responded with matching session ${expectedSessionId}`
        : 'ready tab responded on new-chat surface',
    };
  }

  return null;
}
