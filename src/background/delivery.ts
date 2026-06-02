import {
  ALL_PROVIDERS,
  type LocalState,
  type ProviderDeliveryResult,
  type UserSubmitMessage,
  type Workspace,
} from '../runtime/protocol';
import {
  getLocalState,
  getSessionState,
  updateLocalState,
} from '../runtime/storage';
import { bindAttachments, releaseSubmitAttachments } from '../runtime/attachment-store';
import { formatAttachmentSummary, shortSubmitId } from '../runtime/attachment-log';
import { setWorkspaceEnabledProviders, type WorkspaceLookupResult } from '../runtime/workspace';
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

async function logAttachmentLifecycle(entry: Parameters<typeof logDebug>[0]) {
  try {
    await logDebug(entry);
  } catch (error) {
    console.warn('ask-em: failed to append attachment lifecycle debug log', error);
  }
}

export async function deliverPromptToWorkspaceTargets(
  workspaceId: string,
  message: UserSubmitMessage,
  sourceTabId?: number,
  workspaceSnapshot?: Workspace,
): Promise<ProviderDeliveryResult[]> {
  const [localState, sessionState] = await Promise.all([getLocalState(), getSessionState()]);
  const storedWorkspace = localState.workspaces[workspaceId];
  const workspace = storedWorkspace ?? (workspaceSnapshot?.id === workspaceId ? workspaceSnapshot : null);

  if (!workspace) {
    await logDebug({
      level: 'warn',
      scope: 'background',
      provider: message.provider,
      workspaceId,
      message: 'Skipped fan-out because routed workspace was missing',
      detail: 'No stored workspace and no routed workspace snapshot were available',
    });
    return [];
  }

  if (!storedWorkspace && workspaceSnapshot) {
    // Defensive recovery for a storage/GC interleaving: the submit was already
    // routed to this workspace, so keep fan-out working and leave a clear log
    // marker for root-cause investigation if this appears again.
    await logDebug({
      level: 'warn',
      scope: 'background',
      provider: message.provider,
      workspaceId,
      message: 'Recovered fan-out from routed workspace snapshot',
      detail: `Stored workspace missing during delivery; enabled providers: ${workspace.enabledProviders.join(', ')}`,
    });
  }

  await cancelScheduledGroupGc(workspaceId);

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
  let attachmentWorkspaceId: string | null = null;

  try {
    const tabId = sender.tab?.id;
    let {
      localState,
      workspaceLookup,
      createdWorkspace,
    }: {
      localState: LocalState;
      workspaceLookup: WorkspaceLookupResult;
      createdWorkspace: boolean;
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

    await cancelScheduledGroupGc(workspaceLookup.workspaceId);

    if (message.attachments.length > 0) {
      await bindAttachments(message.submitId, workspaceLookup.workspaceId);
      attachmentWorkspaceId = workspaceLookup.workspaceId;
      await logAttachmentLifecycle({
        level: 'info',
        scope: 'background',
        provider: message.provider,
        workspaceId: workspaceLookup.workspaceId,
        message: 'Bound submit attachments',
        detail: `submit=${shortSubmitId(message.submitId)}; ${formatAttachmentSummary(message.attachments)}`,
      });
    }

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
      workspaceLookup.workspace,
    );
    await logFanOutCompletion(
      message.provider,
      workspaceLookup.workspaceId,
      workspaceLookup.workspace.enabledProviders,
      deliveryResults,
    );

    let finalLocalState = await getLocalState();
    if (createdWorkspace && finalLocalState.pauseAfterFirstFanOutEnabled) {
      finalLocalState = await updateLocalState((currentState) =>
        setWorkspaceEnabledProviders(currentState, workspaceLookup.workspaceId, []),
      );
      await logDebug({
        level: 'info',
        scope: 'background',
        provider: message.provider,
        workspaceId: workspaceLookup.workspaceId,
        message: 'Paused workspace after first fan-out',
      });
    }

    const finalWorkspace =
      finalLocalState.workspaces[workspaceLookup.workspaceId] ?? localState.workspaces[workspaceLookup.workspaceId] ?? workspaceLookup.workspace;

    return buildUserSubmitResult({
      synced: true,
      workspaceId: workspaceLookup.workspaceId,
      providerEnabled: finalWorkspace.enabledProviders.includes(message.provider),
      globalSyncEnabled: true,
      canStartNewSet: canStartNewSet(finalLocalState),
      deliveryResults,
      workspaceSummary: buildWorkspaceSummary(
        finalWorkspace,
        await getSessionState(),
      ),
    });
  } finally {
    if (message.attachments.length > 0) {
      try {
        await releaseSubmitAttachments(message.submitId);
        await logAttachmentLifecycle({
          level: 'info',
          scope: 'background',
          provider: message.provider,
          workspaceId: attachmentWorkspaceId ?? undefined,
          message: 'Released submit attachments',
          detail: `submit=${shortSubmitId(message.submitId)}; ${formatAttachmentSummary(message.attachments)}`,
        });
      } catch (error) {
        await logAttachmentLifecycle({
          level: 'error',
          scope: 'background',
          provider: message.provider,
          message: 'Failed to release submit attachments',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
