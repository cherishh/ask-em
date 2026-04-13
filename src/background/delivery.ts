import {
  ALL_PROVIDERS,
  type LocalState,
  type ProviderDeliveryResult,
  type UserSubmitMessage,
} from '../runtime/protocol';
import {
  getLocalState,
  getSessionState,
  updateLocalState,
} from '../runtime/storage';
import { type WorkspaceLookupResult } from '../runtime/workspace';
import { canCreateWorkspaceFromSubmit, isProviderEnabled, shouldSyncWorkspaceProvider } from '../runtime/guards';
import {
  persistSourceSubmitContext,
  prepareSubmitWorkspaceContext,
} from './delivery-context';
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
  let {
    localState,
    workspaceLookup,
  }: {
    localState: LocalState;
    workspaceLookup: WorkspaceLookupResult;
  } = await prepareSubmitWorkspaceContext({
    tabId,
    message,
    canCreateWorkspace: canCreateWorkspaceFromSubmit,
  });

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

  localState = await persistSourceSubmitContext({
    localState,
    workspaceLookup,
    tabId,
    message,
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
