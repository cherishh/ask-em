import {
  ALL_PROVIDERS,
  type Provider,
  type ProviderDeliveryResult,
  type SwitchProviderTabMessage,
  type UserSubmitMessage,
} from '../runtime/protocol';
import {
  clearClaimedTab,
  getLocalState,
  getSessionState,
  setLocalState,
  updateLocalState,
  upsertClaimedTab,
} from '../runtime/storage';
import {
  bindWorkspaceMember,
  createPendingWorkspace,
  getDefaultEnabledProviderList,
  getWorkspacesOrdered,
} from '../runtime/workspace';
import { canCreateWorkspaceFromSubmit, isProviderEnabled, shouldSyncWorkspaceProvider } from '../runtime/guards';
import { getClaimedTabByTabId } from './claimed-tabs';
import { attemptProviderDelivery } from './delivery-executor';
import { applyDeliveryResultsToWorkspaceIssues } from './delivery-issues';
import {
  createSyncProgressTracker,
  normalizeSettledDeliveryResults,
  notifyInitialSyncProgress,
} from './delivery-progress';
import { buildUserSubmitResult, logFanOutCompletion, type UserSubmitResult } from './delivery-submit';
import { cancelScheduledGroupGc } from './gc';
import { logDebug } from './debug';
import { refreshPendingState } from './state';
import { reconcileClaimedTabContext } from './presence';
import { buildWorkspaceSummary, canStartNewSet } from './status';

export async function deliverPromptToWorkspaceTargets(
  workspaceId: string,
  message: UserSubmitMessage,
  sourceTabId?: number,
): Promise<ProviderDeliveryResult[]> {
  const [localState, sessionState] = await Promise.all([getLocalState(), getSessionState()]);
  const workspace = localState.workspaces[workspaceId];

  if (!workspace) {
    return [];
  }

  cancelScheduledGroupGc(workspaceId);

  const providers = ALL_PROVIDERS.filter((provider) =>
    shouldSyncWorkspaceProvider(message.provider, provider, workspace.enabledProviders),
  );
  const progressTracker = createSyncProgressTracker(sourceTabId, workspaceId, providers.length);

  await notifyInitialSyncProgress(sourceTabId, workspaceId, providers.length);

  const settledResults = await Promise.allSettled(
    providers.map(async (provider) => {
      const deliveryResult = await attemptProviderDelivery({
        workspace,
        workspaceId,
        provider,
        message,
        sessionState,
      });
      await progressTracker.record(deliveryResult);

      return deliveryResult;
    }),
  );

  const deliveryResults = normalizeSettledDeliveryResults(providers, settledResults);

  await updateLocalState((currentState) =>
    applyDeliveryResultsToWorkspaceIssues(currentState, workspaceId, deliveryResults),
  );

  return deliveryResults;
}

export async function handleUserSubmit(
  message: UserSubmitMessage,
  sender: chrome.runtime.MessageSender,
): Promise<UserSubmitResult> {
  const tabId = sender.tab?.id;
  const refreshedState = await refreshPendingState();
  let { localState } = refreshedState;
  const reconciled = tabId
    ? await reconcileClaimedTabContext({
        localState,
        sessionState: refreshedState.sessionState,
        tabId,
        provider: message.provider,
        pageKind: message.pageKind,
        sessionId: message.sessionId,
        currentUrl: message.currentUrl,
        allowClaimedFallback: false,
        logMessages: {
          newChat: 'Detached claimed tab from previous group on new-chat submit',
          foreignSession: 'Detached claimed tab from previous group on existing-session submit',
          unresolvedExistingSession:
            'Detached claimed tab from previous group on unresolved existing-session submit',
        },
      })
    : {
        localState,
        sessionState: refreshedState.sessionState,
        workspaceLookup: null,
      };
  localState = reconciled.localState;
  let workspaceLookup = reconciled.workspaceLookup;

  if (!workspaceLookup && canCreateWorkspaceFromSubmit(localState, message)) {
    const enabledProviders = getDefaultEnabledProviderList(localState, message.provider);
    const label = message.content.trim().slice(0, 80) || undefined;
    localState = createPendingWorkspace(localState, {
      sourceProvider: message.provider,
      sourceUrl: message.currentUrl,
      enabledProviders,
      label,
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
    await logDebug({
      level: 'info',
      scope: 'background',
      provider: message.provider,
      message: 'Ignored submit without workspace',
      detail: `${message.pageKind}: ${message.sessionId ?? 'no-session'} @ ${message.currentUrl}`,
    });
    return buildUserSubmitResult({
      synced: false,
      workspaceId: null,
      globalSyncEnabled: localState.globalSyncEnabled,
      canStartNewSet: canStartNewSet(localState),
      workspaceSummary: null,
    });
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
    return buildUserSubmitResult({
      synced: false,
      workspaceId: workspaceLookup.workspaceId,
      providerEnabled: false,
      globalSyncEnabled: localState.globalSyncEnabled,
      canStartNewSet: canStartNewSet(localState),
      workspaceSummary: buildWorkspaceSummary(
        localState.workspaces[workspaceLookup.workspaceId] ?? workspaceLookup.workspace,
        await getSessionState(),
      ),
    });
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
    return buildUserSubmitResult({
      synced: false,
      workspaceId: workspaceLookup.workspaceId,
      providerEnabled: true,
      globalSyncEnabled: false,
      canStartNewSet: canStartNewSet(localState),
      workspaceSummary: buildWorkspaceSummary(
        localState.workspaces[workspaceLookup.workspaceId] ?? workspaceLookup.workspace,
        await getSessionState(),
      ),
    });
  }

  const deliveryResults = await deliverPromptToWorkspaceTargets(
    workspaceLookup.workspaceId,
    message,
    tabId,
  );
  await logFanOutCompletion(
    message.provider,
    workspaceLookup.workspaceId,
    workspaceLookup.workspace.enabledProviders,
    deliveryResults,
  );

  const finalLocalState = await getLocalState();
  const finalWorkspace =
    finalLocalState.workspaces[workspaceLookup.workspaceId] ?? localState.workspaces[workspaceLookup.workspaceId] ?? workspaceLookup.workspace;

  return buildUserSubmitResult({
    synced: true,
    workspaceId: workspaceLookup.workspaceId,
    providerEnabled: true,
    globalSyncEnabled: true,
    canStartNewSet: canStartNewSet(finalLocalState),
    deliveryResults,
    workspaceSummary: buildWorkspaceSummary(
      finalWorkspace,
      await getSessionState(),
    ),
  });
}

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
