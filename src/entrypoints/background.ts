import { SUPPORTED_SITES } from '../adapters/sites';
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
  getLocalState,
  getSessionState,
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
  getWorkspacesOrdered,
  lookupWorkspaceBySession,
} from '../runtime/workspace';
import { canCreateWorkspaceFromSubmit, shouldSyncWorkspaceProvider } from '../runtime/guards';
import {
  getClaimedTabByTabId,
  isClaimedTabStale,
  removeClaimedTabsForWorkspace,
  resolveDeliveryTarget,
} from '../runtime/recovery';

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
    return { ok: true, workspaceId: null };
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

  return { ok: true, workspaceId: workspaceLookup.workspaceId };
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

      await chrome.tabs.sendMessage(target.tabId, {
        type: 'DELIVER_PROMPT',
        workspaceId,
        provider,
        content: message.content,
        expectedSessionId: target.expectedSessionId,
        expectedUrl: target.expectedUrl,
        timestamp: Date.now(),
      });
    }),
  );
}

async function handleUserSubmit(message: UserSubmitMessage, sender: chrome.runtime.MessageSender) {
  const tabId = sender.tab?.id;
  let { localState } = await refreshPendingState();
  const enabledProviders = SUPPORTED_SITES.map((site) => site.name);
  let workspaceLookup = lookupWorkspaceBySession(localState, message.provider, message.sessionId);

  if (!workspaceLookup && canCreateWorkspaceFromSubmit(localState, message)) {
    localState = createPendingWorkspace(localState, {
      sourceProvider: message.provider,
      sourceUrl: message.currentUrl,
      enabledProviders,
    });

    const workspace = getWorkspacesOrdered(localState)[0];
    workspaceLookup = workspace ? { workspaceId: workspace.id, workspace } : null;
    await setLocalState(localState);
  }

  if (!workspaceLookup?.workspace) {
    return { ok: true, synced: false };
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
    workspaceLimit: 3,
    workspaces,
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
