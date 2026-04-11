import type { ProviderAdapter } from '../adapters/types';
import type { WorkspaceContextResponseMessage } from '../runtime/protocol';
import { sendRuntimeMessage } from './content-routing';
import { createDeliveryController } from './content-delivery-controller';
import { createPresenceController } from './content-presence-controller';
import { createContentState } from './content-state';
import { createSubmitController } from './content-submit-controller';
import { createContentUi } from './content-ui';

export function bootstrapContentScript(adapter: ProviderAdapter): void {
  const ui = createContentUi(adapter, {
    async onWorkspaceProviderToggle(provider, nextEnabled) {
      const workspaceId = state.getUiContext().workspaceId;
      if (!workspaceId) {
        return;
      }

      await sendRuntimeMessage({
        type: 'SET_WORKSPACE_PROVIDER_ENABLED',
        workspaceId,
        provider,
        enabled: nextEnabled,
      });

      const response = await sendRuntimeMessage<WorkspaceContextResponseMessage>({
        type: 'GET_WORKSPACE_CONTEXT',
        workspaceId,
      });
      state.setWorkspaceSummary(response?.workspaceSummary ?? state.getWorkspaceSummary());

      if (provider === adapter.name) {
        state.setProviderEnabled(nextEnabled);
      }

      state.applyIndicatorPresentation();
    },
    onStandaloneSetCreationToggle(nextEnabled) {
      state.setStandaloneCreateSetEnabled(nextEnabled);
      state.applyIndicatorPresentation();
    },
    async onProviderTabSwitch(direction) {
      return await sendRuntimeMessage<{
        ok?: boolean;
        switched?: boolean;
        provider?: typeof adapter.name;
        reason?: string;
      }>({
        type: 'SWITCH_PROVIDER_TAB',
        provider: adapter.name,
        direction,
      });
    },
    async loadWorkspaceContext(workspaceId) {
      return await sendRuntimeMessage<WorkspaceContextResponseMessage>({
        type: 'GET_WORKSPACE_CONTEXT',
        workspaceId,
      });
    },
    async onRefreshContext() {
      await presenceController.reportPresence('HELLO');
    },
  });

  const state = createContentState(adapter, ui);

  const logDebug = async (entry: {
    level: 'info' | 'warn' | 'error';
    message: string;
    detail?: string;
    workspaceId?: string;
  }) => {
    await sendRuntimeMessage({
      type: 'LOG_DEBUG',
      level: entry.level,
      scope: 'content',
      provider: adapter.name,
      workspaceId: entry.workspaceId ?? state.getUiContext().workspaceId ?? undefined,
      message: entry.message,
      detail: entry.detail,
    });
  };

  const presenceController = createPresenceController(adapter, state);
  const submitController = createSubmitController(adapter, state, {
    reportPresence: presenceController.reportPresence,
    logDebug,
  });
  const deliveryController = createDeliveryController(adapter, state, submitController, {
    reportPresence: presenceController.reportPresence,
    logDebug,
  });

  const unsubscribe = adapter.composer?.subscribeToUserSubmissions?.((content) => {
    void submitController.reportUserSubmit(content);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) =>
    deliveryController.handleRuntimeMessage(message, sendResponse),
  );

  presenceController.start();

  window.addEventListener('beforeunload', () => {
    unsubscribe?.();
    presenceController.destroy();
    ui.destroy?.();
  });
}
