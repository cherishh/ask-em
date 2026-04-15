import { createDefaultEnabledProviders, STORAGE_KEYS, type RuntimeMessage } from '../runtime/protocol';
import { clearDebugLogs, getLocalState, getSessionState, setLocalState, setSessionState } from '../runtime/storage';
import { clearWorkspace, clearWorkspaceProvider, setWorkspaceProviderEnabled } from '../runtime/workspace';
import { removeClaimedTabsForWorkspace } from './claimed-tabs';
import { logDebug } from './debug';
import { scheduleEmptyGroupDeletion } from './gc';
import {
  getClaimedTabIdsForWorkspace,
  notifyAllTabsToRefreshContext,
  notifyAllTabsToResetIndicatorPosition,
  notifyTabsToRefreshContext,
} from './tabs';

export async function handleWorkspaceClear(
  message: Extract<RuntimeMessage, { type: 'CLEAR_WORKSPACE' | 'CLEAR_WORKSPACE_PROVIDER' }>,
) {
  const [localState, sessionState] = await Promise.all([getLocalState(), getSessionState()]);

  if (message.type === 'CLEAR_WORKSPACE') {
    const targetTabIds = Array.from(
      new Set(
        Object.values(sessionState.claimedTabs)
          .filter((claimedTab) => claimedTab.workspaceId === message.workspaceId)
          .map((claimedTab) => claimedTab.tabId),
      ),
    );

    await Promise.all([
      setLocalState(clearWorkspace(localState, message.workspaceId)),
      setSessionState(removeClaimedTabsForWorkspace(sessionState, message.workspaceId)),
    ]);
    if ((localState.closeTabsOnDeleteSet ?? false) && targetTabIds.length > 0) {
      await Promise.allSettled(targetTabIds.map(async (tabId) => chrome.tabs.remove(tabId)));
    } else {
      await notifyTabsToRefreshContext(targetTabIds);
    }
    await logDebug({
      level: 'info',
      scope: 'background',
      workspaceId: message.workspaceId,
      message: 'Cleared workspace',
      detail: `${targetTabIds.length} claimed tabs ${
        localState.closeTabsOnDeleteSet ?? false ? 'closed' : 'refreshed'
      }`,
    });

    return { ok: true };
  }

  const claimedTab = sessionState.claimedTabs[`${message.workspaceId}:${message.provider}`];

  await Promise.all([
    setLocalState(clearWorkspaceProvider(localState, message.workspaceId, message.provider)),
    setSessionState({
      ...sessionState,
      claimedTabs: Object.fromEntries(
        Object.entries(sessionState.claimedTabs).filter(
          ([key]) => key !== `${message.workspaceId}:${message.provider}`,
        ),
      ),
    }),
  ]);
  if (claimedTab) {
    await notifyTabsToRefreshContext([claimedTab.tabId]);
  }
  await logDebug({
    level: 'info',
    scope: 'background',
    workspaceId: message.workspaceId,
    provider: message.provider,
    message: 'Removed provider from workspace',
    detail: claimedTab ? `refreshed tab ${claimedTab.tabId}` : 'no claimed tab',
  });

  const nextLocalState = clearWorkspaceProvider(localState, message.workspaceId, message.provider);
  const nextWorkspace = nextLocalState.workspaces[message.workspaceId];
  const isEmptyGroup =
    nextWorkspace &&
    nextWorkspace.enabledProviders.length === 0 &&
    Object.keys(nextWorkspace.members).length === 0;

  if (isEmptyGroup) {
    await scheduleEmptyGroupDeletion(message.workspaceId);
  }

  return { ok: true };
}

export async function handleSetDefaultEnabledProviders(
  message: Extract<RuntimeMessage, { type: 'SET_DEFAULT_ENABLED_PROVIDERS' }>,
) {
  const nextProviders = createDefaultEnabledProviders(message.providers);
  const localState = await getLocalState();
  await setLocalState({
    ...localState,
    defaultEnabledProviders: nextProviders,
  });
  await logDebug({
    level: 'info',
    scope: 'background',
    message: 'Updated default enabled providers',
    detail: message.providers.join(', '),
  });
  return { ok: true };
}

export async function handleSetWorkspaceProviderEnabled(
  message: Extract<RuntimeMessage, { type: 'SET_WORKSPACE_PROVIDER_ENABLED' }>,
) {
  const [localState, sessionState] = await Promise.all([getLocalState(), getSessionState()]);
  const nextState = setWorkspaceProviderEnabled(
    localState,
    message.workspaceId,
    message.provider,
    message.enabled,
  );
  await setLocalState(nextState);
  await notifyTabsToRefreshContext(getClaimedTabIdsForWorkspace(sessionState, message.workspaceId));
  await logDebug({
    level: 'info',
    scope: 'background',
    workspaceId: message.workspaceId,
    provider: message.provider,
    message: message.enabled ? 'Provider rejoined workspace sync' : 'Provider paused for workspace sync',
  });
  return { ok: true };
}

export async function handleSetShortcuts(
  message: Extract<RuntimeMessage, { type: 'SET_SHORTCUTS' }>,
) {
  const localState = await getLocalState();
  await setLocalState({
    ...localState,
    shortcuts: message.shortcuts,
  });
  await notifyAllTabsToRefreshContext();
  return { ok: true };
}

export async function handleSetGlobalSyncEnabled(
  message: Extract<RuntimeMessage, { type: 'SET_GLOBAL_SYNC_ENABLED' }>,
) {
  const localState = await getLocalState();
  await setLocalState({
    ...localState,
    globalSyncEnabled: message.enabled,
  });
  await notifyAllTabsToRefreshContext();
  await logDebug({
    level: 'info',
    scope: 'background',
    message: message.enabled ? 'Global sync resumed' : 'Global sync paused',
  });
  return { ok: true };
}

export async function handleSetAutoSyncNewChatsEnabled(
  message: Extract<RuntimeMessage, { type: 'SET_AUTO_SYNC_NEW_CHATS_ENABLED' }>,
) {
  const localState = await getLocalState();
  await setLocalState({
    ...localState,
    autoSyncNewChatsEnabled: message.enabled,
  });
  await notifyAllTabsToRefreshContext();
  await logDebug({
    level: 'info',
    scope: 'background',
    message: message.enabled ? 'Auto-sync new chats enabled' : 'Auto-sync new chats disabled',
  });
  return { ok: true };
}

export async function handleSetDebugLoggingEnabled(
  message: Extract<RuntimeMessage, { type: 'SET_DEBUG_LOGGING_ENABLED' }>,
) {
  const localState = await getLocalState();
  await setLocalState({
    ...localState,
    debugLoggingEnabled: message.enabled,
    debugLogs: message.enabled ? localState.debugLogs : [],
  });

  if (message.enabled) {
    await logDebug({
      level: 'info',
      scope: 'background',
      message: 'Debug logging enabled',
    });
  }

  return { ok: true };
}

export async function handleSetShowDiagnostics(
  message: Extract<RuntimeMessage, { type: 'SET_SHOW_DIAGNOSTICS' }>,
) {
  const localState = await getLocalState();
  await setLocalState({
    ...localState,
    showDiagnostics: message.enabled,
  });
  return { ok: true };
}

export async function handleSetCloseTabsOnDeleteSet(
  message: Extract<RuntimeMessage, { type: 'SET_CLOSE_TABS_ON_DELETE_SET' }>,
) {
  const localState = await getLocalState();
  await setLocalState({
    ...localState,
    closeTabsOnDeleteSet: message.enabled,
  });
  return { ok: true };
}

export async function handleDebugLog(
  message: Extract<RuntimeMessage, { type: 'LOG_DEBUG' }>,
) {
  await logDebug(message);
  return { ok: true };
}

export async function handleClearDebugLogs() {
  await clearDebugLogs();
  return { ok: true };
}

export async function handleResetIndicatorPositions() {
  await chrome.storage.local.remove(STORAGE_KEYS.indicatorPositions);
  await notifyAllTabsToResetIndicatorPosition();
  return { ok: true };
}

export async function handleClearPersistentStorage() {
  await chrome.storage.local.clear();
  await Promise.all([
    notifyAllTabsToRefreshContext(),
    notifyAllTabsToResetIndicatorPosition(),
  ]);
  return { ok: true };
}
