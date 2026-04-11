import type { RuntimeMessage } from '../runtime/protocol';
import { getSessionState, setSessionState } from '../runtime/storage';
import { removeClaimedTabsForTabId } from '../runtime/recovery';
import { scheduleGroupGcIfEmpty } from '../background/gc';
import { logDebug } from '../background/debug';
import { handlePresenceMessage } from '../background/presence';
import {
  deliverPromptToWorkspaceTargets,
  handleSwitchProviderTab,
  handleUserSubmit,
} from '../background/delivery';
import {
  buildWorkspaceSummary,
  canStartNewSet,
  handleGetDebugLogs,
  handleGetStatus,
  handleGetWorkspaceContext,
} from '../background/status';
import {
  handleClearDebugLogs,
  handleDebugLog,
  handleSetCloseTabsOnDeleteSet,
  handleSetDebugLoggingEnabled,
  handleSetDefaultEnabledProviders,
  handleSetGlobalSyncEnabled,
  handleSetShortcuts,
  handleSetWorkspaceProviderEnabled,
  handleWorkspaceClear,
} from '../background/settings';
import {
  detachClaimedTabForForeignSession,
  detachClaimedTabForNewChat,
  detachClaimedTabForUnresolvedExistingSession,
  transferClaimedTabToWorkspace,
} from '../background/presence';
import { refreshPendingState } from '../background/state';

export {
  buildWorkspaceSummary,
  canStartNewSet,
  deliverPromptToWorkspaceTargets,
  detachClaimedTabForForeignSession,
  detachClaimedTabForNewChat,
  detachClaimedTabForUnresolvedExistingSession,
  handleGetDebugLogs,
  handleGetStatus,
  handleGetWorkspaceContext,
  handleSetCloseTabsOnDeleteSet,
  handleSetDebugLoggingEnabled,
  handleSetDefaultEnabledProviders,
  handleSetGlobalSyncEnabled,
  handleSetShortcuts,
  handleSetWorkspaceProviderEnabled,
  handleSwitchProviderTab,
  handleUserSubmit,
  handleWorkspaceClear,
  refreshPendingState,
  transferClaimedTabToWorkspace,
};

export default defineBackground(() => {
  chrome.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
      const sessionState = await getSessionState();
      const { sessionState: nextSessionState, removedClaimedTabs } = removeClaimedTabsForTabId(sessionState, tabId);

      if (removedClaimedTabs.length === 0) {
        return;
      }

      await setSessionState(nextSessionState);

      for (const claimedTab of removedClaimedTabs) {
        await logDebug({
          level: 'info',
          scope: 'background',
          workspaceId: claimedTab.workspaceId,
          provider: claimedTab.provider,
          message: 'Observed provider tab close',
        });
        await scheduleGroupGcIfEmpty(claimedTab.workspaceId);
      }
    })();
  });

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
    void (async () => {
      switch (message.type) {
        case 'HELLO':
        case 'HEARTBEAT':
          sendResponse(await handlePresenceMessage(message, sender));
          return;
        case 'USER_SUBMIT':
          sendResponse(await handleUserSubmit(message, sender));
          return;
        case 'SWITCH_PROVIDER_TAB':
          sendResponse(await handleSwitchProviderTab(message, sender));
          return;
        case 'GET_STATUS':
          sendResponse(await handleGetStatus());
          return;
        case 'GET_WORKSPACE_CONTEXT':
          sendResponse(await handleGetWorkspaceContext(message));
          return;
        case 'GET_DEBUG_LOGS':
          sendResponse(await handleGetDebugLogs());
          return;
        case 'SET_DEFAULT_ENABLED_PROVIDERS':
          sendResponse(await handleSetDefaultEnabledProviders(message));
          return;
        case 'SET_WORKSPACE_PROVIDER_ENABLED':
          sendResponse(await handleSetWorkspaceProviderEnabled(message));
          return;
        case 'SET_GLOBAL_SYNC_ENABLED':
          sendResponse(await handleSetGlobalSyncEnabled(message));
          return;
        case 'SET_CLOSE_TABS_ON_DELETE_SET':
          sendResponse(await handleSetCloseTabsOnDeleteSet(message));
          return;
        case 'SET_SHORTCUTS':
          sendResponse(await handleSetShortcuts(message));
          return;
        case 'SET_DEBUG_LOGGING_ENABLED':
          sendResponse(await handleSetDebugLoggingEnabled(message));
          return;
        case 'LOG_DEBUG':
          sendResponse(await handleDebugLog(message));
          return;
        case 'CLEAR_DEBUG_LOGS':
          sendResponse(await handleClearDebugLogs());
          return;
        case 'CLEAR_WORKSPACE':
        case 'CLEAR_WORKSPACE_PROVIDER':
          sendResponse(await handleWorkspaceClear(message));
          return;
        default:
          sendResponse({ ok: false, reason: `Unhandled message type: ${message.type}` });
      }
    })();

    return true;
  });
});
