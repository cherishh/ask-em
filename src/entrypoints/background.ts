import { SUPPORTED_SITES } from '../adapters/sites';
import { createDefaultEnabledProviders, type DebugLogEntry } from '../runtime/protocol';
import {
  type GetStatusMessage,
  type HeartbeatMessage,
  type HelloMessage,
  type Provider,
  type RuntimeMessage,
  type StatusResponseMessage,
  type UserSubmitMessage,
} from '../runtime/protocol';
import {
  appendDebugLog,
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
  getClaimedTabByTabId,
  isClaimedTabStale,
  removeClaimedTabsForWorkspace,
  resolveDeliveryTarget,
} from '../runtime/recovery';

async function logDebug(entry: Omit<DebugLogEntry, 'id' | 'timestamp'> & Partial<Pick<DebugLogEntry, 'id' | 'timestamp'>>) {
  await appendDebugLog(entry);
}

async function refreshPendingState() {
  const [localState, sessionState] = await Promise.all([getLocalState(), getSessionState()]);
  const cleanupResult = cleanupPendingWorkspaces(localState, sessionState);

  if (cleanupResult.removedWorkspaceIds.length > 0) {
    await setLocalState(cleanupResult.localState);
  }

  return {
    localState: cleanupResult.localState,
    sessionState,
  };
}

async function handlePresenceMessage(message: HelloMessage | HeartbeatMessage, sender: chrome.runtime.MessageSender) {
  const tabId = sender.tab?.id;
  if (!tabId) {
    return { ok: false };
  }

  let { localState, sessionState } = await refreshPendingState();
  let workspaceLookup = lookupWorkspaceBySession(localState, message.provider, message.sessionId);

  if (!workspaceLookup) {
    const claimedTab = getClaimedTabByTabId(sessionState, tabId, message.provider);

    if (claimedTab) {
      workspaceLookup = {
        workspaceId: claimedTab.workspaceId,
        workspace: localState.workspaces[claimedTab.workspaceId],
      };
    }
  }

  if (!workspaceLookup?.workspace) {
    return { ok: true, workspaceId: null, providerEnabled: false };
  }

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

  const providers = SUPPORTED_SITES.map((site) => site.name).filter((provider) =>
    shouldSyncWorkspaceProvider(message.provider, provider, workspace.enabledProviders),
  );

  await Promise.allSettled(
    providers.map(async (provider) => {
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
    }),
  );
}

async function handleUserSubmit(message: UserSubmitMessage, sender: chrome.runtime.MessageSender) {
  const tabId = sender.tab?.id;
  let { localState } = await refreshPendingState();
  let workspaceLookup = lookupWorkspaceBySession(localState, message.provider, message.sessionId);

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
    return { ok: true, synced: false };
  }

  if (!isProviderEnabled(workspaceLookup.workspace.enabledProviders, message.provider)) {
    await logDebug({
      level: 'info',
      scope: 'background',
      provider: message.provider,
      workspaceId: workspaceLookup.workspaceId,
      message: 'Ignored submit from disabled provider',
    });
    return { ok: true, synced: false, workspaceId: workspaceLookup.workspaceId };
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
  await deliverPromptToWorkspaceTargets(workspaceLookup.workspaceId, message);

  return {
    ok: true,
    synced: true,
    workspaceId: workspaceLookup.workspaceId,
  };
}

async function handleGetStatus(_message: GetStatusMessage): Promise<StatusResponseMessage> {
  const [localState, sessionState] = await Promise.all([getLocalState(), getSessionState()]);
  const workspaces = getWorkspacesOrdered(localState).map((workspace) => {
    const memberStatuses = Object.fromEntries(
      SUPPORTED_SITES.map((site) => {
        const member = workspace.members[site.name];
        const claimedTab = sessionState.claimedTabs[`${workspace.id}:${site.name}`];

        if (member?.sessionId === null || workspace.pendingSource === site.name) {
          return [site.name, 'pending'];
        }

        if (!member) {
          return [site.name, 'missing'];
        }

        if (!claimedTab) {
          return [site.name, 'missing'];
        }

        return [site.name, isClaimedTabStale(claimedTab) ? 'stale' : 'healthy'];
      }),
    );

    return {
      workspace,
      memberStatuses,
    };
  });

  return {
    type: 'STATUS_RESPONSE',
    globalSyncEnabled: localState.globalSyncEnabled,
    debugLoggingEnabled: localState.debugLoggingEnabled,
    workspaceLimit: 3,
    defaultEnabledProviders: localState.defaultEnabledProviders,
    workspaces,
    recentLogs: localState.debugLogs.slice(-20).reverse(),
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
    await Promise.all([
      setLocalState(clearWorkspace(localState, message.workspaceId)),
      setSessionState(removeClaimedTabsForWorkspace(sessionState, message.workspaceId)),
    ]);

    return { ok: true };
  }

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
  const localState = await getLocalState();
  const nextState = setWorkspaceProviderEnabled(
    localState,
    message.workspaceId,
    message.provider,
    message.enabled,
  );
  await setLocalState(nextState);
  await logDebug({
    level: 'info',
    scope: 'background',
    workspaceId: message.workspaceId,
    provider: message.provider,
    message: message.enabled ? 'Provider rejoined workspace sync' : 'Provider paused for workspace sync',
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
        case 'GET_STATUS':
          sendResponse(await handleGetStatus(message));
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
