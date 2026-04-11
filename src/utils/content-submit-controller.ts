import type { ProviderAdapter } from '../adapters/types';
import { buildUserSubmitMessage, sendRuntimeMessage } from './content-routing';
import type { ContentStateController, SubmitResponse } from './content-state';

export function createSubmitController(
  adapter: ProviderAdapter,
  state: ContentStateController,
  dependencies: {
    reportPresence: (kind: 'HELLO' | 'HEARTBEAT') => Promise<void>;
    logDebug: (entry: {
      level: 'info' | 'warn' | 'error';
      message: string;
      detail?: string;
      workspaceId?: string;
    }) => Promise<void>;
  },
) {
  const reportUserSubmit = async (rawContent: string) => {
    const content = rawContent.trim();
    if (!content || Date.now() < state.getSuppressSubmissionsUntil()) {
      return;
    }

    if (state.shouldSuppressProgrammaticSubmit(content)) {
      await dependencies.logDebug({
        level: 'info',
        message: 'Skipped programmatic submit echo',
        detail: content.slice(0, 120),
      });
      return;
    }

    const status = adapter.session.getStatus();
    const fingerprint = `${status.currentUrl}::${content}`;

    if (
      fingerprint === state.getLastFingerprint() &&
      Date.now() - state.getLastFingerprintAt() < 1_500
    ) {
      return;
    }

    state.setLastFingerprint(fingerprint, Date.now());

    const uiContext = state.getUiContext();
    if (
      !uiContext.workspaceId &&
      status.pageKind === 'new-chat' &&
      status.sessionId === null &&
      !uiContext.standaloneCreateSetEnabled
    ) {
      state.applyIndicatorPresentation(status);
      await dependencies.logDebug({
        level: 'info',
        message: 'Skipped new set creation for standalone chat',
        detail: content.slice(0, 120),
      });
      return;
    }

    await dependencies.logDebug({
      level: 'info',
      message: 'Detected user submit',
      detail: content.slice(0, 120),
    });

    state.setSyncing();

    const response = await sendRuntimeMessage<SubmitResponse>(buildUserSubmitMessage(status, content), {
      onError(error) {
        console.warn('ask-em: failed to report user submit', error);
      },
    });
    state.applySubmitResponse(response);
    state.applyIndicatorPresentation();
  };

  return {
    reportUserSubmit,
    suppressObservedSubmissionsFor(durationMs: number) {
      state.setSuppressSubmissionsUntil(Date.now() + durationMs);
    },
    rememberProgrammaticSubmit(content: string) {
      state.rememberProgrammaticSubmit(content);
    },
  };
}

export type ContentSubmitController = ReturnType<typeof createSubmitController>;
