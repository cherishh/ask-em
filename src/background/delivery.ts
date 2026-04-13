import {
  ALL_PROVIDERS,
  type Provider,
  type ProviderDeliveryResult,
  type SwitchProviderTabMessage,
  type SyncProgressMessage,
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
  clearWorkspaceProviderIssue,
  createPendingWorkspace,
  getDefaultEnabledProviderList,
  getWorkspacesOrdered,
  setWorkspaceProviderIssue,
} from '../runtime/workspace';
import { canCreateWorkspaceFromSubmit, isProviderEnabled, shouldSyncWorkspaceProvider } from '../runtime/guards';
import {
  resolveDeliveryTarget,
  resolveReadyProviderTabForWorkspace,
} from './delivery-targets';
import { getClaimedTabByTabId } from './claimed-tabs';
import { cancelScheduledGroupGc } from './gc';
import { logDebug } from './debug';
import { notifySyncProgress } from './tabs';
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

  let completed = 0;
  let succeeded = 0;
  let failed = 0;

  if (sourceTabId && providers.length > 0) {
    await notifySyncProgress(sourceTabId, {
      type: 'SYNC_PROGRESS',
      workspaceId,
      total: providers.length,
      completed: 0,
      succeeded: 0,
      failed: 0,
    });
  }

  const settledResults = await Promise.allSettled(
    providers.map(async (provider) => {
      let deliveryResult: ProviderDeliveryResult;
      const existingIssue = workspace.memberIssues?.[provider] ?? null;
      let deliveryTargetOverride: Awaited<ReturnType<typeof resolveReadyProviderTabForWorkspace>> = null;

      if (existingIssue === 'needs-login') {
        deliveryTargetOverride = await resolveReadyProviderTabForWorkspace(
          workspace,
          provider,
          sessionState,
        );

        if (!deliveryTargetOverride) {
          const reason = `${provider} login required`;
          await logDebug({
            level: 'info',
            scope: 'background',
            provider,
            workspaceId,
            message: 'Skipped delivery for provider with known login issue',
            detail: reason,
          });

          deliveryResult = {
            provider,
            ok: false,
            reason,
          } satisfies ProviderDeliveryResult;

          completed += 1;
          failed += 1;

          if (sourceTabId) {
            await notifySyncProgress(sourceTabId, {
              type: 'SYNC_PROGRESS',
              workspaceId,
              total: providers.length,
              completed,
              succeeded,
              failed,
            });
          }

          return deliveryResult;
        }

        await logDebug({
          level: 'info',
          scope: 'background',
          provider,
          workspaceId,
          message: 'Recovered delivery target from ready tab after login issue',
          detail: deliveryTargetOverride.reason,
        });
      }

      try {
        const target = deliveryTargetOverride ?? (await resolveDeliveryTarget(workspace, provider, sessionState));
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

        const payload = response as {
          ok?: boolean;
          accepted?: boolean;
          confirmed?: boolean;
          blocked?: boolean;
          error?: string;
        } | undefined;

        if (payload?.accepted) {
          await logDebug({
            level: 'info',
            scope: 'background',
            provider,
            workspaceId,
            message: 'Prompt delivery accepted',
            detail: `${message.provider} -> ${provider}`,
          });
        }

        if (!payload?.ok || payload?.confirmed === false) {
          const reason =
            payload?.error ??
            (payload?.confirmed === false
              ? 'Prompt delivery was not confirmed'
              : payload?.blocked
                ? 'Prompt delivery blocked'
                : 'Prompt delivery failed');
          await logDebug({
            level: payload?.blocked || payload?.confirmed === false ? 'warn' : 'error',
            scope: 'background',
            provider,
            workspaceId,
            message: payload?.confirmed === false
              ? 'Prompt delivery confirmation failed'
              : payload?.blocked
                ? 'Prompt delivery blocked'
                : 'Prompt delivery failed',
            detail: reason,
          });
          deliveryResult = {
            provider,
            ok: false,
            accepted: payload?.accepted,
            confirmed: payload?.confirmed,
            blocked: payload?.blocked,
            reason,
          } satisfies ProviderDeliveryResult;
        } else {
          await logDebug({
            level: 'info',
            scope: 'background',
            provider,
            workspaceId,
            message: 'Prompt delivery confirmed',
            detail: `${message.provider} -> ${provider}`,
          });

          deliveryResult = {
            provider,
            ok: true,
            accepted: payload?.accepted,
            confirmed: payload?.confirmed,
          } satisfies ProviderDeliveryResult;
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const isLoginRequired = reason.toLowerCase().includes('login required');
        await logDebug({
          level: isLoginRequired ? 'warn' : 'error',
          scope: 'background',
          provider,
          workspaceId,
          message: isLoginRequired ? 'Prompt delivery login required' : 'Prompt delivery threw',
          detail: reason,
        });
        deliveryResult = {
          provider,
          ok: false,
          reason,
        } satisfies ProviderDeliveryResult;
      }

      completed += 1;
      if (deliveryResult.ok) {
        succeeded += 1;
      } else {
        failed += 1;
      }

      if (sourceTabId) {
        await notifySyncProgress(sourceTabId, {
          type: 'SYNC_PROGRESS',
          workspaceId,
          total: providers.length,
          completed,
          succeeded,
          failed,
        });
      }

      return deliveryResult;
    }),
  );

  const deliveryResults = settledResults.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }

    const provider = providers[index];
    return {
      provider,
      ok: false,
      reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
    } satisfies ProviderDeliveryResult;
  });

  await updateLocalState((currentState) =>
    deliveryResults.reduce((nextState, result) => {
      if (result.ok) {
        return clearWorkspaceProviderIssue(nextState, workspaceId, result.provider);
      }

      const normalizedReason = (result.reason ?? '').toLowerCase();
      const issue =
        normalizedReason.includes('login required')
          ? 'needs-login'
          : normalizedReason.includes('not ready') || normalizedReason.includes('blocked')
            ? 'loading'
            : 'delivery-failed';

      return setWorkspaceProviderIssue(nextState, workspaceId, result.provider, issue);
    }, currentState),
  );

  return deliveryResults;
}

export async function handleUserSubmit(message: UserSubmitMessage, sender: chrome.runtime.MessageSender) {
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
    return {
      ok: true,
      synced: false,
      workspaceId: null,
      globalSyncEnabled: localState.globalSyncEnabled,
      canStartNewSet: canStartNewSet(localState),
      workspaceSummary: null,
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
      workspaceSummary: buildWorkspaceSummary(
        localState.workspaces[workspaceLookup.workspaceId] ?? workspaceLookup.workspace,
        await getSessionState(),
      ),
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
      workspaceSummary: buildWorkspaceSummary(
        localState.workspaces[workspaceLookup.workspaceId] ?? workspaceLookup.workspace,
        await getSessionState(),
      ),
    };
  }

  const deliveryResults = await deliverPromptToWorkspaceTargets(
    workspaceLookup.workspaceId,
    message,
    tabId,
  );
  if (deliveryResults.length > 0) {
    const succeeded = deliveryResults.filter((result) => result.ok);
    const failed = deliveryResults.filter((result) => !result.ok);
    await logDebug({
      level: failed.length > 0 ? 'warn' : 'info',
      scope: 'background',
      provider: message.provider,
      workspaceId: workspaceLookup.workspaceId,
      message: 'Sync fan-out completed',
      detail: failed.length > 0
        ? `${succeeded.length}/${deliveryResults.length} ok; failed: ${failed
            .map((result) => `${result.provider}${result.reason ? ` (${result.reason})` : ''}`)
            .join(', ')}`
        : `${succeeded.length}/${deliveryResults.length} ok`,
    });
  } else {
    await logDebug({
      level: 'info',
      scope: 'background',
      provider: message.provider,
      workspaceId: workspaceLookup.workspaceId,
      message: 'No sync fan-out targets',
      detail: workspaceLookup.workspace.enabledProviders.join(', '),
    });
  }

  const finalLocalState = await getLocalState();
  const finalWorkspace =
    finalLocalState.workspaces[workspaceLookup.workspaceId] ?? localState.workspaces[workspaceLookup.workspaceId] ?? workspaceLookup.workspace;

  return {
    ok: true,
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
  };
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
