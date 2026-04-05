import { describe, expect, it } from 'vitest';
import { createDefaultEnabledProviders, HEARTBEAT_STALE_MS, type LocalState, type SessionState } from './protocol';
import {
  bindWorkspaceMember,
  cleanupPendingWorkspaces,
  clearWorkspace,
  clearWorkspaceProvider,
  createPendingWorkspace,
  enforceWorkspaceLimit,
  getDefaultEnabledProviderList,
  lookupWorkspaceBySession,
  rebuildWorkspaceIndex,
  setWorkspaceProviderEnabled,
} from './workspace';
import { countClaimedTabsForWorkspace, isClaimedTabStale, removeClaimedTabsForTabId } from './recovery';

function createEmptyState(): LocalState {
  return {
    globalSyncEnabled: true,
    debugLoggingEnabled: false,
    defaultEnabledProviders: createDefaultEnabledProviders(),
    workspaces: {},
    workspaceIndex: {},
    debugLogs: [],
  };
}

function createEmptySessionState(): SessionState {
  return {
    claimedTabs: {},
  };
}

describe('workspace state', () => {
  it('creates a pending workspace from a new-chat source', () => {
    const nextState = createPendingWorkspace(createEmptyState(), {
      sourceProvider: 'gemini',
      sourceUrl: 'https://gemini.google.com/app',
      enabledProviders: ['gemini', 'chatgpt'],
      now: 100,
      workspaceId: 'w1',
    });

    expect(nextState.workspaces.w1).toMatchObject({
      id: 'w1',
      pendingSource: 'gemini',
      enabledProviders: ['gemini', 'chatgpt'],
    });
    expect(nextState.workspaces.w1.members.gemini?.sessionId).toBeNull();
  });

  it('binds members and indexes them by provider plus session', () => {
    const pending = createPendingWorkspace(createEmptyState(), {
      sourceProvider: 'gemini',
      sourceUrl: 'https://gemini.google.com/app',
      workspaceId: 'w1',
    });

    const bound = bindWorkspaceMember(pending, {
      workspaceId: 'w1',
      now: 150,
      member: {
        provider: 'gemini',
        sessionId: 'g-1',
        url: 'https://gemini.google.com/app/g-1',
      },
    });

    expect(bound.workspaceIndex['gemini:g-1']).toBe('w1');
    expect(bound.workspaces.w1.pendingSource).toBeUndefined();
    expect(lookupWorkspaceBySession(bound, 'gemini', 'g-1')?.workspaceId).toBe('w1');
  });

  it('does not cross-route multiple workspaces on the same provider', () => {
    let state = createPendingWorkspace(createEmptyState(), {
      sourceProvider: 'gemini',
      sourceUrl: 'https://gemini.google.com/app',
      workspaceId: 'w1',
    });
    state = bindWorkspaceMember(state, {
      workspaceId: 'w1',
      member: {
        provider: 'gemini',
        sessionId: 'g-1',
        url: 'https://gemini.google.com/app/g-1',
      },
    });

    state = createPendingWorkspace(state, {
      sourceProvider: 'gemini',
      sourceUrl: 'https://gemini.google.com/app',
      workspaceId: 'w2',
    });
    state = bindWorkspaceMember(state, {
      workspaceId: 'w2',
      member: {
        provider: 'gemini',
        sessionId: 'g-2',
        url: 'https://gemini.google.com/app/g-2',
      },
    });

    expect(lookupWorkspaceBySession(state, 'gemini', 'g-1')?.workspaceId).toBe('w1');
    expect(lookupWorkspaceBySession(state, 'gemini', 'g-2')?.workspaceId).toBe('w2');
  });

  it('removes the old session index when rebinding a provider to a new session', () => {
    let state = createPendingWorkspace(createEmptyState(), {
      sourceProvider: 'claude',
      sourceUrl: 'https://claude.ai/new',
      workspaceId: 'w1',
    });
    state = bindWorkspaceMember(state, {
      workspaceId: 'w1',
      member: {
        provider: 'claude',
        sessionId: 'c-1',
        url: 'https://claude.ai/chat/c-1',
      },
    });

    state = bindWorkspaceMember(state, {
      workspaceId: 'w1',
      member: {
        provider: 'claude',
        sessionId: 'c-2',
        url: 'https://claude.ai/chat/c-2',
      },
    });

    expect(state.workspaceIndex['claude:c-1']).toBeUndefined();
    expect(state.workspaceIndex['claude:c-2']).toBe('w1');
    expect(lookupWorkspaceBySession(state, 'claude', 'c-1')).toBeNull();
    expect(lookupWorkspaceBySession(state, 'claude', 'c-2')?.workspaceId).toBe('w1');
  });

  it('rebuilds the workspace index from the current workspace members', () => {
    let state = createPendingWorkspace(createEmptyState(), {
      sourceProvider: 'chatgpt',
      sourceUrl: 'https://chatgpt.com/',
      workspaceId: 'w1',
    });
    state = bindWorkspaceMember(state, {
      workspaceId: 'w1',
      member: {
        provider: 'chatgpt',
        sessionId: 'gpt-1',
        url: 'https://chatgpt.com/c/gpt-1',
      },
    });

    const rebuilt = rebuildWorkspaceIndex(state.workspaces);

    expect(rebuilt).toEqual({
      'chatgpt:gpt-1': 'w1',
    });
  });

  it('clears a single provider binding without deleting the workspace', () => {
    let state = createPendingWorkspace(createEmptyState(), {
      sourceProvider: 'claude',
      sourceUrl: 'https://claude.ai/new',
      workspaceId: 'w1',
    });
    state = bindWorkspaceMember(state, {
      workspaceId: 'w1',
      member: {
        provider: 'claude',
        sessionId: 'c-1',
        url: 'https://claude.ai/chat/c-1',
      },
    });
    state = bindWorkspaceMember(state, {
      workspaceId: 'w1',
      member: {
        provider: 'chatgpt',
        sessionId: 'gpt-9',
        url: 'https://chatgpt.com/c/gpt-9',
      },
    });

    const nextState = clearWorkspaceProvider(state, 'w1', 'chatgpt');

    expect(nextState.workspaces.w1).toBeDefined();
    expect(nextState.workspaces.w1.members.chatgpt).toBeUndefined();
    expect(nextState.workspaces.w1.enabledProviders).not.toContain('chatgpt');
    expect(nextState.workspaceIndex['chatgpt:gpt-9']).toBeUndefined();
    expect(nextState.workspaceIndex['claude:c-1']).toBe('w1');
  });

  it('can remove a provider that is enabled but not yet bound', () => {
    const state = createPendingWorkspace(createEmptyState(), {
      sourceProvider: 'gemini',
      sourceUrl: 'https://gemini.google.com/app',
      workspaceId: 'w1',
      enabledProviders: ['gemini', 'claude'],
    });

    const nextState = clearWorkspaceProvider(state, 'w1', 'claude');

    expect(nextState.workspaces.w1.enabledProviders).toEqual(['gemini']);
    expect(nextState.workspaces.w1.members.claude).toBeUndefined();
  });

  it('clears an entire workspace and all of its member indexes', () => {
    let state = createPendingWorkspace(createEmptyState(), {
      sourceProvider: 'claude',
      sourceUrl: 'https://claude.ai/new',
      workspaceId: 'w1',
    });
    state = bindWorkspaceMember(state, {
      workspaceId: 'w1',
      member: {
        provider: 'claude',
        sessionId: 'c-1',
        url: 'https://claude.ai/chat/c-1',
      },
    });

    const nextState = clearWorkspace(state, 'w1');

    expect(nextState.workspaces.w1).toBeUndefined();
    expect(nextState.workspaceIndex['claude:c-1']).toBeUndefined();
  });

  it('enforces the workspace limit of three', () => {
    const state: LocalState = {
      globalSyncEnabled: true,
      debugLoggingEnabled: false,
      defaultEnabledProviders: createDefaultEnabledProviders(),
      workspaces: {
        w1: { id: 'w1', members: {}, enabledProviders: [], createdAt: 1, updatedAt: 1 },
        w2: { id: 'w2', members: {}, enabledProviders: [], createdAt: 2, updatedAt: 2 },
        w3: { id: 'w3', members: {}, enabledProviders: [], createdAt: 3, updatedAt: 3 },
      },
      workspaceIndex: {},
      debugLogs: [],
    };

    expect(() => enforceWorkspaceLimit(state)).toThrow(/Workspace limit reached/);
  });

  it('cleans up timed-out pending workspaces', () => {
    const state = createPendingWorkspace(createEmptyState(), {
      sourceProvider: 'deepseek',
      sourceUrl: 'https://chat.deepseek.com/',
      now: 100,
      workspaceId: 'w1',
    });

    const result = cleanupPendingWorkspaces(state, createEmptySessionState(), 31_500);

    expect(result.removedWorkspaceIds).toEqual(['w1']);
    expect(result.localState.workspaces.w1).toBeUndefined();
  });

  it('marks stale claimed tabs using the heartbeat threshold', () => {
    expect(
      isClaimedTabStale(
        {
          provider: 'claude',
          workspaceId: 'w1',
          tabId: 9,
          currentUrl: 'https://claude.ai/chat/c-1',
          sessionId: 'c-1',
          pageState: 'ready',
          lastSeenAt: 100,
        },
        100 + HEARTBEAT_STALE_MS + 1,
      ),
    ).toBe(true);
  });

  it('builds default enabled providers while forcing the source provider in', () => {
    const state: LocalState = {
      ...createEmptyState(),
      defaultEnabledProviders: createDefaultEnabledProviders(['chatgpt', 'deepseek']),
    };

    expect(getDefaultEnabledProviderList(state, 'gemini')).toEqual(['gemini', 'chatgpt', 'deepseek']);
  });

  it('can pause a provider without removing its binding', () => {
    let state = createPendingWorkspace(createEmptyState(), {
      sourceProvider: 'gemini',
      sourceUrl: 'https://gemini.google.com/app',
      workspaceId: 'w1',
      enabledProviders: ['gemini', 'chatgpt', 'claude'],
    });

    state = setWorkspaceProviderEnabled(state, 'w1', 'chatgpt', false);

    expect(state.workspaces.w1.enabledProviders).toEqual(['gemini', 'claude']);
    expect(state.workspaces.w1.members.gemini).toBeDefined();
  });

  it('removes claimed tabs by tab id and can count remaining tabs per group', () => {
    const sessionState: SessionState = {
      claimedTabs: {
        'w1:claude': {
          provider: 'claude',
          workspaceId: 'w1',
          tabId: 11,
          currentUrl: 'https://claude.ai/chat/c-1',
          sessionId: 'c-1',
          pageState: 'ready',
          lastSeenAt: 100,
        },
        'w1:chatgpt': {
          provider: 'chatgpt',
          workspaceId: 'w1',
          tabId: 12,
          currentUrl: 'https://chatgpt.com/c/g-1',
          sessionId: 'g-1',
          pageState: 'ready',
          lastSeenAt: 100,
        },
      },
    };

    const result = removeClaimedTabsForTabId(sessionState, 11);

    expect(result.removedClaimedTabs).toHaveLength(1);
    expect(countClaimedTabsForWorkspace(result.sessionState, 'w1')).toBe(1);
  });
});
