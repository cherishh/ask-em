import { describe, expect, it } from 'vitest';
import type { Provider, WorkspaceSummary } from '../runtime/protocol';
import {
  countWorkspaceIssues,
  getContentIndicatorPresentation,
  type ContentIndicatorInput,
} from './content-indicator';

function createWorkspaceSummary(
  overrides: Partial<WorkspaceSummary> = {},
  enabledProviders: Provider[] = ['claude', 'chatgpt', 'gemini'],
): WorkspaceSummary {
  return {
    workspace: {
      id: 'w1',
      members: Object.fromEntries(
        enabledProviders.map((provider) => [
          provider,
          {
            provider,
            sessionId: `${provider}-1`,
            url: `https://${provider}.example.com/${provider}-1`,
          },
        ]),
      ),
      enabledProviders,
      createdAt: 1,
      updatedAt: 1,
    },
    memberStates: Object.fromEntries(enabledProviders.map((provider) => [provider, 'ready'])),
    memberIssues: Object.fromEntries(enabledProviders.map((provider) => [provider, null])),
    ...overrides,
  };
}

function createInput(overrides: Partial<ContentIndicatorInput> = {}): ContentIndicatorInput {
  return {
    hasWorkspace: false,
    globalSyncEnabled: true,
    providerEnabled: true,
    standaloneReady: true,
    standaloneCreateSetEnabled: true,
    canStartNewSet: true,
    pageState: 'ready',
    workspaceSummary: null,
    syncProgress: null,
    ...overrides,
  };
}

describe('content indicator presentation', () => {
  it('shows standalone ready state when next prompt will fan out', () => {
    expect(getContentIndicatorPresentation(createInput())).toEqual({
      state: 'idle',
      label: 'ready',
      syncLabel: 'next prompt will fan out',
      syncTone: 'neutral',
      alertLevel: 'normal',
    });
  });

  it('shows standalone blocked copy when fan-out is turned off', () => {
    expect(
      getContentIndicatorPresentation(
        createInput({
          standaloneCreateSetEnabled: false,
        }),
      ),
    ).toEqual({
      state: 'blocked',
      label: 'Local only',
      syncLabel: 'next prompt stays here',
      syncTone: 'neutral',
      alertLevel: 'normal',
    });
  });

  it('shows standalone login-required pages as not sync-eligible', () => {
    expect(
      getContentIndicatorPresentation(
        createInput({
          pageState: 'login-required',
        }),
      ),
    ).toEqual({
      state: 'blocked',
      label: 'needs login',
      syncLabel: 'sign in to sync',
      syncTone: 'warning',
      alertLevel: 'current-warning',
    });
  });

  it('shows standalone error pages as needing a valid chat', () => {
    expect(
      getContentIndicatorPresentation(
        createInput({
          pageState: 'error',
        }),
      ),
    ).toEqual({
      state: 'blocked',
      label: 'page has an error',
      syncLabel: 'open a valid chat to sync',
      syncTone: 'warning',
      alertLevel: 'current-warning',
    });
  });

  it('shows standalone set limit warning', () => {
    expect(
      getContentIndicatorPresentation(
        createInput({
          canStartNewSet: false,
        }),
      ),
    ).toEqual({
      state: 'blocked',
      label: 'ready',
      syncLabel: 'set limit reached',
      syncTone: 'warning',
      alertLevel: 'normal',
    });
  });

  it('shows standalone global pause as local-only mode', () => {
    expect(
      getContentIndicatorPresentation(
        createInput({
          globalSyncEnabled: false,
        }),
      ),
    ).toEqual({
      state: 'blocked',
      label: 'Local only',
      syncLabel: 'next prompt stays here',
      syncTone: 'neutral',
      alertLevel: 'normal',
    });
  });

  it('shows healthy workspace as synced', () => {
    expect(
      getContentIndicatorPresentation(
        createInput({
          hasWorkspace: true,
          workspaceSummary: createWorkspaceSummary(),
        }),
      ),
    ).toEqual({
      state: 'idle',
      label: 'current model is in sync',
      syncLabel: 'all models synced',
      syncTone: 'neutral',
      alertLevel: 'normal',
    });
  });

  it('shows workspace pause on the current model line', () => {
    expect(
      getContentIndicatorPresentation(
        createInput({
          hasWorkspace: true,
          providerEnabled: false,
          workspaceSummary: createWorkspaceSummary(),
        }),
      ),
    ).toEqual({
      state: 'blocked',
      label: 'current model sync paused',
      syncLabel: 'this tab is paused',
      syncTone: 'neutral',
      alertLevel: 'normal',
    });
  });

  it('shows global pause for workspace sync', () => {
    expect(
      getContentIndicatorPresentation(
        createInput({
          hasWorkspace: true,
          globalSyncEnabled: false,
          workspaceSummary: createWorkspaceSummary(),
        }),
      ),
    ).toEqual({
      state: 'blocked',
      label: 'current model sync paused',
      syncLabel: 'sync paused',
      syncTone: 'neutral',
      alertLevel: 'normal',
    });
  });

  it('surfaces current-tab login problems as current warnings', () => {
    const summary = createWorkspaceSummary({
      memberStates: {
        claude: 'login-required',
        chatgpt: 'ready',
        gemini: 'ready',
      },
    });

    expect(
      getContentIndicatorPresentation(
        createInput({
          hasWorkspace: true,
          pageState: 'login-required',
          workspaceSummary: summary,
        }),
      ),
    ).toEqual({
      state: 'blocked',
      label: 'current model needs login',
      syncLabel: 'sign in to sync',
      syncTone: 'warning',
      alertLevel: 'current-warning',
    });
  });

  it('surfaces current-tab loading problems as current warnings', () => {
    const summary = createWorkspaceSummary({
      memberStates: {
        claude: 'not-ready',
        chatgpt: 'ready',
        gemini: 'ready',
      },
    });

    expect(
      getContentIndicatorPresentation(
        createInput({
          hasWorkspace: true,
          pageState: 'not-ready',
          workspaceSummary: summary,
        }),
      ),
    ).toEqual({
      state: 'blocked',
      label: 'current model is loading',
      syncLabel: 'wait for page to become ready',
      syncTone: 'warning',
      alertLevel: 'current-warning',
    });
  });

  it('surfaces current-tab error pages as current warnings', () => {
    const summary = createWorkspaceSummary({
      memberStates: {
        claude: 'error',
        chatgpt: 'ready',
        gemini: 'ready',
      },
      memberIssues: {
        claude: 'error-page',
        chatgpt: null,
        gemini: null,
      },
    });

    expect(
      getContentIndicatorPresentation(
        createInput({
          hasWorkspace: true,
          pageState: 'error',
          workspaceSummary: summary,
        }),
      ),
    ).toEqual({
      state: 'blocked',
      label: 'current model page has an error',
      syncLabel: 'page needs attention',
      syncTone: 'warning',
      alertLevel: 'current-warning',
    });
  });

  it('surfaces other-provider issues as set warnings only', () => {
    const summary = createWorkspaceSummary({
      memberStates: {
        claude: 'ready',
        chatgpt: 'login-required',
        gemini: 'not-ready',
      },
    });

    expect(countWorkspaceIssues(summary)).toBe(2);
    expect(
      getContentIndicatorPresentation(
        createInput({
          hasWorkspace: true,
          workspaceSummary: summary,
        }),
      ),
    ).toEqual({
      state: 'idle',
      label: 'current model is in sync',
      syncLabel: '2 models need attention',
      syncTone: 'warning',
      alertLevel: 'set-warning',
    });
  });

  it('does not warn for recoverable no-live-tab members', () => {
    const summary = createWorkspaceSummary({
      memberStates: {
        claude: 'ready',
        chatgpt: 'inactive',
        gemini: 'ready',
      },
    });

    expect(countWorkspaceIssues(summary)).toBe(0);
    expect(
      getContentIndicatorPresentation(
        createInput({
          hasWorkspace: true,
          workspaceSummary: summary,
        }),
      ),
    ).toEqual({
      state: 'idle',
      label: 'current model is in sync',
      syncLabel: 'all models synced',
      syncTone: 'neutral',
      alertLevel: 'normal',
    });
  });

  it('still warns when an inactive member has a persisted sync issue', () => {
    const summary = createWorkspaceSummary({
      memberStates: {
        claude: 'ready',
        chatgpt: 'inactive',
        gemini: 'ready',
      },
      memberIssues: {
        claude: null,
        chatgpt: 'needs-login',
        gemini: null,
      },
    });

    expect(countWorkspaceIssues(summary)).toBe(1);
    expect(
      getContentIndicatorPresentation(
        createInput({
          hasWorkspace: true,
          workspaceSummary: summary,
        }),
      ),
    ).toEqual({
      state: 'idle',
      label: 'current model is in sync',
      syncLabel: '1 model needs attention',
      syncTone: 'warning',
      alertLevel: 'set-warning',
    });
  });

  it('shows initial sync progress before any target has completed', () => {
    expect(
      getContentIndicatorPresentation(
        createInput({
          hasWorkspace: true,
          workspaceSummary: createWorkspaceSummary(),
          syncProgress: {
            workspaceId: 'w1',
            total: 3,
            completed: 0,
            succeeded: 0,
            failed: 0,
          },
        }),
      ),
    ).toEqual({
      state: 'syncing',
      label: 'current model is in sync',
      syncLabel: 'syncing 3 models',
      syncTone: 'neutral',
      alertLevel: 'normal',
    });
  });

  it('shows partial sync progress while targets are succeeding', () => {
    expect(
      getContentIndicatorPresentation(
        createInput({
          hasWorkspace: true,
          workspaceSummary: createWorkspaceSummary(),
          syncProgress: {
            workspaceId: 'w1',
            total: 3,
            completed: 2,
            succeeded: 2,
            failed: 0,
          },
        }),
      ),
    ).toEqual({
      state: 'syncing',
      label: 'current model is in sync',
      syncLabel: '2 of 3 synced',
      syncTone: 'neutral',
      alertLevel: 'normal',
    });
  });

  it('shows partial sync failures as set warnings during progress', () => {
    expect(
      getContentIndicatorPresentation(
        createInput({
          hasWorkspace: true,
          workspaceSummary: createWorkspaceSummary(),
          syncProgress: {
            workspaceId: 'w1',
            total: 3,
            completed: 2,
            succeeded: 1,
            failed: 1,
          },
        }),
      ),
    ).toEqual({
      state: 'syncing',
      label: 'current model is in sync',
      syncLabel: '1 of 3 synced',
      syncTone: 'warning',
      alertLevel: 'set-warning',
    });
  });
});
