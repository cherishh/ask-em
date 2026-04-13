import type { WorkspaceSummary } from '../runtime/protocol';
import { DEFAULT_SHORTCUTS } from '../runtime/protocol';
import {
  buildPresenceContextTransition,
  buildSubmitContextTransition,
  type PresenceResponse,
  type SubmitResponse,
} from './context';
import type { UiContext } from './ui';

export type ViewRuntime = {
  uiContext: UiContext;
  workspaceSummary: WorkspaceSummary | null;
  hasHydratedPresence: boolean;
  standaloneCreateSetTouched: boolean;
};

export function createInitialViewRuntime(): ViewRuntime {
  return {
    uiContext: {
      workspaceId: null,
      providerEnabled: true,
      globalSyncEnabled: true,
      standaloneReady: false,
      standaloneCreateSetEnabled: true,
      canStartNewSet: true,
      shortcuts: DEFAULT_SHORTCUTS,
    },
    workspaceSummary: null,
    hasHydratedPresence: false,
    standaloneCreateSetTouched: false,
  };
}

export function setViewStandaloneCreateSetEnabled(
  viewRuntime: ViewRuntime,
  nextEnabled: boolean,
): UiContext {
  viewRuntime.standaloneCreateSetTouched = true;
  viewRuntime.uiContext = {
    ...viewRuntime.uiContext,
    standaloneCreateSetEnabled: nextEnabled,
  };

  return viewRuntime.uiContext;
}

export function setViewProviderEnabled(
  viewRuntime: ViewRuntime,
  nextEnabled: boolean,
): UiContext {
  viewRuntime.uiContext = {
    ...viewRuntime.uiContext,
    providerEnabled: nextEnabled,
  };

  return viewRuntime.uiContext;
}

export function setViewWorkspaceSummary(
  viewRuntime: ViewRuntime,
  workspaceSummary: WorkspaceSummary | null,
) {
  viewRuntime.workspaceSummary = workspaceSummary;
}

export function applyPresenceResponseToView(
  viewRuntime: ViewRuntime,
  response: PresenceResponse | null,
  standaloneVisible: boolean,
) {
  const transition = buildPresenceContextTransition({
    currentContext: viewRuntime.uiContext,
    response,
    standaloneVisible,
    hasHydratedPresence: viewRuntime.hasHydratedPresence,
    standaloneCreateSetTouched: viewRuntime.standaloneCreateSetTouched,
  });

  viewRuntime.workspaceSummary = transition.workspaceSummary;
  viewRuntime.uiContext = transition.uiContext;
  viewRuntime.standaloneCreateSetTouched = transition.standaloneCreateSetTouched;
  viewRuntime.hasHydratedPresence = transition.hasHydratedPresence;

  return {
    uiContext: viewRuntime.uiContext,
    visible: transition.visible,
  };
}

export function applySubmitResponseToView(
  viewRuntime: ViewRuntime,
  response: SubmitResponse | null,
  standaloneVisible: boolean,
) {
  const transition = buildSubmitContextTransition({
    currentContext: viewRuntime.uiContext,
    response,
    standaloneVisible,
  });

  viewRuntime.workspaceSummary = transition.workspaceSummary;
  viewRuntime.uiContext = transition.uiContext;

  return {
    uiContext: viewRuntime.uiContext,
    visible: transition.visible,
  };
}
