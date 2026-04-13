import {
  ALL_PROVIDERS,
  type SwitchProviderTabMessage,
} from '../runtime/protocol';
import { clearClaimedTab } from '../runtime/storage';
import { getClaimedTabByTabId } from './claimed-tabs';
import { logDebug } from './debug';
import { refreshPendingState } from './state';

export async function handleSwitchProviderTab(
  message: SwitchProviderTabMessage,
  sender: chrome.runtime.MessageSender,
) {
  const tabId = sender.tab?.id;
  if (!tabId) {
    return {
      ok: false,
      switched: false,
      reason: 'No active provider tab',
    };
  }

  const { localState, sessionState } = await refreshPendingState();
  const currentClaimedTab = getClaimedTabByTabId(sessionState, tabId, message.provider);
  const workspace = currentClaimedTab ? localState.workspaces[currentClaimedTab.workspaceId] : null;

  if (!currentClaimedTab || !workspace) {
    return {
      ok: true,
      switched: false,
      reason: 'Not in a set',
    };
  }

  const providerOrder = ALL_PROVIDERS.filter(
    (provider) => sessionState.claimedTabs[`${currentClaimedTab.workspaceId}:${provider}`],
  );
  const currentIndex = providerOrder.indexOf(message.provider);

  if (providerOrder.length < 2 || currentIndex === -1) {
    return {
      ok: true,
      switched: false,
      reason: 'No other provider tab',
    };
  }

  const offset = message.direction === 'next' ? 1 : -1;
  const targetIndex = (currentIndex + offset + providerOrder.length) % providerOrder.length;
  const targetProvider = providerOrder[targetIndex];
  const targetClaimedTab = sessionState.claimedTabs[`${currentClaimedTab.workspaceId}:${targetProvider}`];

  if (!targetClaimedTab) {
    return {
      ok: true,
      switched: false,
      reason: 'No other provider tab',
    };
  }

  try {
    const targetTab = await chrome.tabs.update(targetClaimedTab.tabId, { active: true });
    if (typeof targetTab?.windowId === 'number') {
      await chrome.windows.update(targetTab.windowId, { focused: true });
    }

    await logDebug({
      level: 'info',
      scope: 'background',
      workspaceId: currentClaimedTab.workspaceId,
      provider: targetProvider,
      message: 'Switched provider tab',
      detail: `${message.provider} -> ${targetProvider}`,
    });

    return {
      ok: true,
      switched: true,
      provider: targetProvider,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await clearClaimedTab(currentClaimedTab.workspaceId, targetProvider);
    await logDebug({
      level: 'warn',
      scope: 'background',
      workspaceId: currentClaimedTab.workspaceId,
      provider: targetProvider,
      message: 'Provider tab switch target unavailable',
      detail: reason,
    });

    return {
      ok: false,
      switched: false,
      reason: 'Provider tab unavailable',
    };
  }
}
