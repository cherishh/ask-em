import { MAX_WORKSPACES, createDefaultEnabledProviders, type DebugLogEntry } from '../runtime/protocol';
import {
  ALL_PROVIDERS,
  type GetWorkspaceContextMessage,
  type HeartbeatMessage,
  type HelloMessage,
  type Provider,
  type RuntimeMessage,
  type StatusResponseMessage,
  type UserSubmitMessage,
} from '../runtime/protocol';
import {
  appendDebugLog,
  clearClaimedTab,
  clearDebugLogs,
  getSessionState,
  getLocalState,
  setLocalState,
  setSessionState,
  upsertClaimedTab,
} from '../runtime/storage';
import {
  bindWorkspaceMember,
  cleanupPendingWorkspaces,
  clearWorkspace,
  clearWorkspaceProvider,
  createPendingWorkspace,
  getDefaultEnabledProviderList,
  getWorkspacesOrdered,
  lookupWorkspaceBySession,
  setWorkspaceProviderEnabled,
} from '../runtime/workspace';
import { canCreateWorkspaceFromSubmit, isProviderEnabled, shouldSyncWorkspaceProvider } from '../runtime/guards';
import {
  countClaimedTabsForWorkspace,
  getClaimedTabByTabId,
  isClaimedTabStale,
  reconcileClaimedTabsWithBrowser,
  removeClaimedTabsForTabId,
  removeClaimedTabsForWorkspace,
  resolveDeliveryTarget,
} from '../runtime/recovery';
import { createSerializedExecutor } from '../runtime/serialized-executor';

const AUTO_CLEAR_GROUP_DELAY_MS = 7_000;
const EMPTY_GROUP_DELETE_DELAY_MS = 2_000;
const pendingGroupGcTimers = new Map<string, ReturnType<typeof setTimeout>>();
const runSerializedBackgroundTask = createSerializedExecutor();

async function notifyTabsToRefreshContext(tabIds: number[]) {
  await Promise.allSettled(
    Array.from(new Set(tabIds)).map(async (tabId) => {
      await chrome.tabs.sendMessage(tabId, {
        type: 'REFRESH_CONTENT_CONTEXT',
      });
    }),
  );
}

function getClaimedTabIdsForWorkspace(sessionState: Awaited<ReturnType<typeof getSessionState>>, workspaceId: string) {
  return Object.values(sessionState.claimedTabs)
    .filter((claimedTab) => claimedTab.workspaceId === workspaceId)
    .map((claimedTab) => claimedTab.tabId);
}

async function notifyAllTabsToRefreshContext() {
  const tabs: chrome.tabs.Tab[] = await chrome.tabs.query({});
  await notifyTabsToRefreshContext(
    tabs.map((tab) => tab.id).filter((tabId): tabId is number => typeof tabId === 'number'),
  );
}

async function logDebug(entry: Omit<DebugLogEntry, 'id' | 'timestamp'> & Partial<Pick<DebugLogEntry, 'id' | 'timestamp'>>) {
  await appendDebugLog(entry);
}

function cancelScheduledGroupGc(workspaceId: string) {
  const timeoutId = pendingGroupGcTimers.get(workspaceId);
  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
    pendingGroupGcTimers.delete(workspaceId);
  }
}

async function scheduleGroupGcIfEmpty(workspaceId: string) {
  cancelScheduledGroupGc(workspaceId);

  const sessionState = await getSessionState();
  if (countClaimedTabsForWorkspace(sessionState, workspaceId) > 0) {
    return;
  }

  const timeoutId = setTimeout(() => {
    pendingGroupGcTimers.delete(workspaceId);

    void runSerializedBackgroundTask(async () => {
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
    });
  }, AUTO_CLEAR_GROUP_DELAY_MS);

  pendingGroupGcTimers.set(workspaceId, timeoutId);
}

async function scheduleEmptyGroupDeletion(workspaceId: string) {
  cancelScheduledGroupGc(workspaceId);

  const timeoutId = setTimeout(() => {
    pendingGroupGcTimers.delete(workspaceId);

    void runSerializedBackgroundTask(async () => {
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
    });
  }, EMPTY_GROUP_DELETE_DELAY_MS);

  pendingGroupGcTimers.set(workspaceId, timeoutId);
}

async function refreshPendingState() {
  const [localState, rawSessionState] = await Promise.all([getLocalState(), getSessionState()]);
  const reconciliation = await reconcileClaimedTabsWithBrowser(rawSessionState);
  const cleanupResult = cleanupPendingWorkspaces(localState, reconciliation.sessionState);

  if (reconciliation.removedClaimedTabs.length > 0) {
    await setSessionState(reconciliation.sessionState);

    for (const claimedTab of reconciliation.removedClaimedTabs) {
      await logDebug({
        level: 'info',
        scope: 'background',
        workspaceId: claimedTab.workspaceId,
        provider: claimedTab.provider,
        message: 'Reconciled missing claimed tab',
      });
      await scheduleGroupGcIfEmpty(claimedTab.workspaceId);
    }
  }

  if (cleanupResult.removedWorkspaceIds.length > 0) {
    await setLocalState(cleanupResult.localState);
  }

  return {
    localState: cleanupResult.localState,
    sessionState: reconciliation.sessionState,
  };
}

export async function detachClaimedTabForNewChat(
  localState: Awaited<ReturnType<typeof getLocalState>>,
  sessionState: Awaited<ReturnType<typeof getSessionState>>,
  tabId: number,
  provider: Provider,
  currentUrl: string,
  logMessage: string,
) {
  const claimedTab = getClaimedTabByTabId(sessionState, tabId, provider);
  const claimedWorkspace = claimedTab ? localState.workspaces[claimedTab.workspaceId] : null;
  const member = claimedWorkspace?.members[provider];
  const isPendingSourceBinding = Boolean(
    claimedWorkspace &&
    claimedWorkspace.pendingSource === provider &&
    claimedWorkspace.members[provider]?.sessionId === null,
  );
  const hasBoundMemberSession = Boolean(member?.sessionId);
  const isStillOnBoundUrl = Boolean(member?.url && currentUrl === member.url);

  if (
    !claimedTab ||
    !claimedWorkspace ||
    isPendingSourceBinding ||
    !hasBoundMemberSession ||
    isStillOnBoundUrl
  ) {
    return {
      sessionState,
      detachedWorkspaceId: null,
    };
  }

  const nextSessionState = await clearClaimedTab(claimedTab.workspaceId, provider);

  await logDebug({
    level: 'info',
    scope: 'background',
    workspaceId: claimedTab.workspaceId,
    provider,
    message: logMessage,
  });

  await scheduleGroupGcIfEmpty(claimedTab.workspaceId);

  return {
    sessionState: nextSessionState,
    detachedWorkspaceId: claimedTab.workspaceId,
  };
}

async function handlePresenceMessage(message: HelloMessage | HeartbeatMessage, sender: chrome.runtime.MessageSender) {
  const tabId = sender.tab?.id;
  if (!tabId) {
    return { ok: false };
  }

  const refreshedState = await refreshPendingState();
  let localState = refreshedState.localState;
  let sessionState = refreshedState.sessionState;

  if (message.pageKind === 'new-chat' && message.sessionId === null) {
    const detachResult = await detachClaimedTabForNewChat(
      localState,
      sessionState,
      tabId,
      message.provider,
      message.currentUrl,
      'Detached claimed tab from previous group on new-chat navigation',
    );
    sessionState = detachResult.sessionState;
  }

  let workspaceLookup = lookupWorkspaceBySession(localState, message.provider, message.sessionId);

  if (!workspaceLookup) {
    const claimedTab = getClaimedTabByTabId(sessionState, tabId, message.provider);
    const claimedWorkspace = claimedTab ? localState.workspaces[claimedTab.workspaceId] : null;

    if (claimedTab && claimedWorkspace) {
      workspaceLookup = {
        workspaceId: claimedTab.workspaceId,
        workspace: claimedWorkspace,
      };
    }
  }

  if (!workspaceLookup?.workspace) {
    return {
      ok: true,
      workspaceId: null,
      providerEnabled: false,
      globalSyncEnabled: localState.globalSyncEnabled,
      canStartNewSet: canStartNewSet(localState),
    };
  }

  cancelScheduledGroupGc(workspaceLookup.workspaceId);

  await upsertClaimedTab(workspaceLookup.workspaceId, message.provider, {
    provider: message.provider,
    workspaceId: workspaceLookup.workspaceId,
    tabId,
    lastSeenAt: 'timestamp' in message ? message.timestamp : Date.now(),
    pageState: message.pageState,
    currentUrl: message.currentUrl,
    sessionId: message.sessionId,
  });

  if (message.sessionId) {
    localState = bindWorkspaceMember(localState, {
      workspaceId: workspaceLookup.workspaceId,
      member: {
        provider: message.provider,
        sessionId: message.sessionId,
        url: message.currentUrl,
      },
    });

    await setLocalState(localState);
  }

  return {
    ok: true,
    workspaceId: workspaceLookup.workspaceId,
    providerEnabled: isProviderEnabled(workspaceLookup.workspace.enabledProviders, message.provider),
    globalSyncEnabled: localState.globalSyncEnabled,
    canStartNewSet: canStartNewSet(localState),
    enabledProviders: workspaceLookup.workspace.enabledProviders,
  };
}

async function deliverPromptToWorkspaceTargets(
  workspaceId: string,
  message: UserSubmitMessage,
): Promise<void> {
  const [localState, sessionState] = await Promise.all([getLocalState(), getSessionState()]);
  const workspace = localState.workspaces[workspaceId];

  if (!workspace) {
    return;
  }

  cancelScheduledGroupGc(workspaceId);

  const providers = ALL_PROVIDERS.filter((provider) =>
    shouldSyncWorkspaceProvider(message.provider, provider, workspace.enabledProviders),
  );

  await Promise.allSettled(
    providers.map(async (provider) => {
      try {
        const target = await resolveDeliveryTarget(workspace, provider, sessionState);
        await upsertClaimedTab(workspaceId, provider, {
          provider,
          workspaceId,
          tabId: target.tabId,
          lastSeenAt: Date.now(),
          pageState: 'not-ready',
          currentUrl: target.expectedUrl ?? '',
          sessionId: target.expectedSessionId,
        });

        await logDebug({
          level: 'info',
          scope: 'background',
          provider,
          workspaceId,
          message: 'Resolved delivery target',
          detail: `${target.resolution}: ${target.reason}`,
        });

        await logDebug({
          level: 'info',
          scope: 'background',
          provider,
          workspaceId,
          message: 'Delivering prompt',
          detail: `${message.provider} -> ${provider} @ ${target.expectedSessionId ?? 'new-chat'}`,
        });

        const response = await chrome.tabs.sendMessage(target.tabId, {
          type: 'DELIVER_PROMPT',
          workspaceId,
          provider,
          content: message.content,
          expectedSessionId: target.expectedSessionId,
          expectedUrl: target.expectedUrl,
          timestamp: Date.now(),
        });

        const payload = response as { ok?: boolean; blocked?: boolean; error?: string } | undefined;
        if (!payload?.ok) {
          await logDebug({
            level: payload?.blocked ? 'warn' : 'error',
            scope: 'background',
            provider,
            workspaceId,
            message: payload?.blocked ? 'Prompt delivery blocked' : 'Prompt delivery failed',
            detail: payload?.error,
          });
        }
      } catch (error) {
        await logDebug({
          level: 'error',
          scope: 'background',
          provider,
          workspaceId,
          message: 'Prompt delivery threw',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );
}

async function handleUserSubmit(message: UserSubmitMessage, sender: chrome.runtime.MessageSender) {
  const tabId = sender.tab?.id;
  let { localState, sessionState } = await refreshPendingState();
  let workspaceLookup = lookupWorkspaceBySession(localState, message.provider, message.sessionId);

  if (!workspaceLookup && tabId && message.pageKind === 'new-chat' && message.sessionId === null) {
    const detachResult = await detachClaimedTabForNewChat(
      localState,
      sessionState,
      tabId,
      message.provider,
      message.currentUrl,
      'Detached claimed tab from previous group on new-chat submit',
    );
    sessionState = detachResult.sessionState;
  }

  if (!workspaceLookup && canCreateWorkspaceFromSubmit(localState, message)) {
    const enabledProviders = getDefaultEnabledProviderList(localState, message.provider);
    localState = createPendingWorkspace(localState, {
      sourceProvider: message.provider,
      sourceUrl: message.currentUrl,
      enabledProviders,
    });

    const workspace = getWorkspacesOrdered(localState)[0];
    workspaceLookup = workspace ? { workspaceId: workspace.id, workspace } : null;
    await setLocalState(localState);
    await logDebug({
      level: 'info',
      scope: 'background',
      provider: message.provider,
      workspaceId: workspaceLookup?.workspaceId,
      message: 'Created workspace from new-chat submit',
      detail: enabledProviders.join(', '),
    });
  }

  if (!workspaceLookup?.workspace) {
    return {
      ok: true,
      synced: false,
      workspaceId: null,
      globalSyncEnabled: localState.globalSyncEnabled,
      canStartNewSet: canStartNewSet(localState),
    };
  }

  cancelScheduledGroupGc(workspaceLookup.workspaceId);

  if (!isProviderEnabled(workspaceLookup.workspace.enabledProviders, message.provider)) {
    await logDebug({
      level: 'info',
      scope: 'background',
      provider: message.provider,
      workspaceId: workspaceLookup.workspaceId,
      message: 'Ignored submit from disabled provider',
    });
    return {
      ok: true,
      synced: false,
      workspaceId: workspaceLookup.workspaceId,
      providerEnabled: false,
      globalSyncEnabled: localState.globalSyncEnabled,
      canStartNewSet: canStartNewSet(localState),
    };
  }

  if (message.sessionId) {
    localState = bindWorkspaceMember(localState, {
      workspaceId: workspaceLookup.workspaceId,
      member: {
        provider: message.provider,
        sessionId: message.sessionId,
        url: message.currentUrl,
      },
    });
    await setLocalState(localState);
  }

  if (tabId) {
    await upsertClaimedTab(workspaceLookup.workspaceId, message.provider, {
      provider: message.provider,
      workspaceId: workspaceLookup.workspaceId,
      tabId,
      lastSeenAt: Date.now(),
      pageState: 'ready',
      currentUrl: message.currentUrl,
      sessionId: message.sessionId,
    });
  }

  await logDebug({
    level: 'info',
    scope: 'background',
    provider: message.provider,
    workspaceId: workspaceLookup.workspaceId,
    message: 'User submit routed',
    detail: message.content.slice(0, 120),
  });

  if (!localState.globalSyncEnabled) {
    await logDebug({
      level: 'info',
      scope: 'background',
      provider: message.provider,
      workspaceId: workspaceLookup.workspaceId,
      message: 'Skipped sync fan-out because global sync is paused',
    });
    return {
      ok: true,
      synced: false,
      workspaceId: workspaceLookup.workspaceId,
      providerEnabled: true,
      globalSyncEnabled: false,
      canStartNewSet: canStartNewSet(localState),
    };
  }

  await deliverPromptToWorkspaceTargets(workspaceLookup.workspaceId, message);

  return {
    ok: true,
    synced: true,
    workspaceId: workspaceLookup.workspaceId,
    providerEnabled: true,
    globalSyncEnabled: true,
    canStartNewSet: canStartNewSet(localState),
  };
}

async function handleGetStatus(): Promise<StatusResponseMessage> {
  const { localState, sessionState } = await refreshPendingState();
  const visibleWorkspaces = getWorkspacesOrdered(localState).filter(
    (workspace) => workspace.enabledProviders.length > 0 || Object.keys(workspace.members).length > 0,
  );
  const workspaces = visibleWorkspaces.map((workspace) => buildWorkspaceSummary(workspace, sessionState));

  return {
    type: 'STATUS_RESPONSE',
    globalSyncEnabled: localState.globalSyncEnabled,
    debugLoggingEnabled: localState.debugLoggingEnabled,
    workspaceLimit: MAX_WORKSPACES,
    defaultEnabledProviders: localState.defaultEnabledProviders,
    workspaces,
    recentLogs: localState.debugLogs.slice(-20).reverse(),
  };
}

function buildWorkspaceSummary(
  workspace: StatusResponseMessage['workspaces'][number]['workspace'],
  sessionState: Awaited<ReturnType<typeof getSessionState>>,
) {
  const memberStates = Object.fromEntries(
    ALL_PROVIDERS.map((provider) => {
      const member = workspace.members[provider];
      const claimedTab = sessionState.claimedTabs[`${workspace.id}:${provider}`];

      if (member?.sessionId === null || workspace.pendingSource === provider) {
        return [provider, 'pending'];
      }

      if (!member) {
        return [provider, 'inactive'];
      }

      if (!claimedTab) {
        return [provider, 'inactive'];
      }

      return [provider, isClaimedTabStale(claimedTab) ? 'stale' : 'active'];
    }),
  );

  return {
    workspace,
    memberStates,
  };
}

function canStartNewSet(localState: Awaited<ReturnType<typeof getLocalState>>): boolean {
  return getWorkspacesOrdered(localState).length < MAX_WORKSPACES;
}

async function handleGetWorkspaceContext(message: GetWorkspaceContextMessage) {
  const { localState, sessionState } = await refreshPendingState();
  const workspace = localState.workspaces[message.workspaceId];

  return {
    type: 'WORKSPACE_CONTEXT_RESPONSE' as const,
    globalSyncEnabled: localState.globalSyncEnabled,
    workspaceSummary: workspace ? buildWorkspaceSummary(workspace, sessionState) : null,
  };
}

async function handleGetDebugLogs() {
  const localState = await getLocalState();
  return {
    type: 'DEBUG_LOGS_RESPONSE' as const,
    logs: localState.debugLogs,
  };
}

async function handleWorkspaceClear(
  message: Extract<RuntimeMessage, { type: 'CLEAR_WORKSPACE' | 'CLEAR_WORKSPACE_PROVIDER' }>,
) {
  const [localState, sessionState] = await Promise.all([getLocalState(), getSessionState()]);

  if (message.type === 'CLEAR_WORKSPACE') {
    const targetTabIds = Object.values(sessionState.claimedTabs)
      .filter((claimedTab) => claimedTab.workspaceId === message.workspaceId)
      .map((claimedTab) => claimedTab.tabId);

    await Promise.all([
      setLocalState(clearWorkspace(localState, message.workspaceId)),
      setSessionState(removeClaimedTabsForWorkspace(sessionState, message.workspaceId)),
    ]);
    await notifyTabsToRefreshContext(targetTabIds);

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

async function handleSetDefaultEnabledProviders(
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

async function handleSetWorkspaceProviderEnabled(
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

async function handleSetGlobalSyncEnabled(
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

async function handleSetDebugLoggingEnabled(
  message: Extract<RuntimeMessage, { type: 'SET_DEBUG_LOGGING_ENABLED' }>,
) {
  const localState = await getLocalState();
  await setLocalState({
    ...localState,
    debugLoggingEnabled: message.enabled,
    debugLogs: message.enabled ? localState.debugLogs : [],
  });

  if (message.enabled) {
    await appendDebugLog({
      level: 'info',
      scope: 'background',
      message: 'Debug logging enabled',
    });
  }

  return { ok: true };
}

async function handleDebugLog(
  message: Extract<RuntimeMessage, { type: 'LOG_DEBUG' }>,
) {
  await logDebug(message);
  return { ok: true };
}

async function handleClearDebugLogs() {
  await clearDebugLogs();
  return { ok: true };
}

export default defineBackground(() => {
  chrome.tabs.onRemoved.addListener((tabId) => {
    void runSerializedBackgroundTask(async () => {
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
    });
  });

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
    void runSerializedBackgroundTask(async () => {
      try {
        switch (message.type) {
          case 'HELLO':
          case 'HEARTBEAT':
            sendResponse(await handlePresenceMessage(message, sender));
            return;
          case 'USER_SUBMIT':
            sendResponse(await handleUserSubmit(message, sender));
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
      } catch (error) {
        sendResponse({
          ok: false,
          reason: error instanceof Error ? error.message : 'Unknown background error',
        });
      }
    });

    return true;
  });
});
