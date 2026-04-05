import {
  MAX_WORKSPACES,
  PENDING_WORKSPACE_TIMEOUT_MS,
  toClaimedTabKey,
  toWorkspaceIndexKey,
  type ConversationRef,
  type LocalState,
  type Provider,
  type SessionState,
  type Workspace,
  type WorkspaceIndex,
} from './protocol';

export type CreatePendingWorkspaceInput = {
  sourceProvider: Provider;
  sourceUrl: string;
  enabledProviders?: Provider[];
  now?: number;
  workspaceId?: string;
};

export type BindWorkspaceMemberInput = {
  workspaceId: string;
  member: ConversationRef;
  now?: number;
};

export type WorkspaceLookupResult = {
  workspaceId: string;
  workspace: Workspace;
} | null;

export type PendingWorkspaceCleanupResult = {
  localState: LocalState;
  removedWorkspaceIds: string[];
};

export function getDefaultEnabledProviderList(state: LocalState, sourceProvider?: Provider): Provider[] {
  const selected = Object.entries(state.defaultEnabledProviders)
    .filter(([, enabled]) => enabled)
    .map(([provider]) => provider as Provider);

  if (sourceProvider && !selected.includes(sourceProvider)) {
    selected.unshift(sourceProvider);
  }

  return Array.from(new Set(selected));
}

export function createPendingWorkspace(
  state: LocalState,
  input: CreatePendingWorkspaceInput,
): LocalState {
  enforceWorkspaceLimit(state);

  const now = input.now ?? Date.now();
  const workspaceId = input.workspaceId ?? crypto.randomUUID();
  const enabledProviders = input.enabledProviders ?? [input.sourceProvider];

  const workspace: Workspace = {
    id: workspaceId,
    members: {
      [input.sourceProvider]: {
        provider: input.sourceProvider,
        sessionId: null,
        url: input.sourceUrl,
      },
    },
    enabledProviders,
    createdAt: now,
    updatedAt: now,
    pendingSource: input.sourceProvider,
  };

  return {
    ...state,
    workspaces: {
      ...state.workspaces,
      [workspaceId]: workspace,
    },
  };
}

export function bindWorkspaceMember(
  state: LocalState,
  input: BindWorkspaceMemberInput,
): LocalState {
  const workspace = state.workspaces[input.workspaceId];

  if (!workspace) {
    return state;
  }

  const now = input.now ?? Date.now();
  const members = {
    ...workspace.members,
    [input.member.provider]: input.member,
  };
  const nextWorkspace: Workspace = {
    ...workspace,
    members,
    updatedAt: now,
    pendingSource:
      workspace.pendingSource === input.member.provider && input.member.sessionId
        ? undefined
        : workspace.pendingSource,
  };
  const nextWorkspaceIndex = { ...state.workspaceIndex };
  const previousMember = workspace.members[input.member.provider];

  if (previousMember?.sessionId && previousMember.sessionId !== input.member.sessionId) {
    delete nextWorkspaceIndex[toWorkspaceIndexKey(input.member.provider, previousMember.sessionId)];
  }

  if (input.member.sessionId) {
    nextWorkspaceIndex[toWorkspaceIndexKey(input.member.provider, input.member.sessionId)] =
      workspace.id;
  }

  return {
    ...state,
    workspaces: {
      ...state.workspaces,
      [workspace.id]: nextWorkspace,
    },
    workspaceIndex: nextWorkspaceIndex,
  };
}

export function rebuildWorkspaceIndex(workspaces: Record<string, Workspace>): WorkspaceIndex {
  const workspaceIndex: WorkspaceIndex = {};

  for (const workspace of Object.values(workspaces)) {
    for (const member of Object.values(workspace.members)) {
      if (!member?.sessionId) {
        continue;
      }

      workspaceIndex[toWorkspaceIndexKey(member.provider, member.sessionId)] = workspace.id;
    }
  }

  return workspaceIndex;
}

export function lookupWorkspaceBySession(
  state: LocalState,
  provider: Provider,
  sessionId: string | null,
): WorkspaceLookupResult {
  if (!sessionId) {
    return null;
  }

  const workspaceId = state.workspaceIndex[toWorkspaceIndexKey(provider, sessionId)];

  if (!workspaceId) {
    return null;
  }

  const workspace = state.workspaces[workspaceId];
  return workspace ? { workspaceId, workspace } : null;
}

export function clearWorkspace(state: LocalState, workspaceId: string): LocalState {
  const workspace = state.workspaces[workspaceId];

  if (!workspace) {
    return state;
  }

  const nextWorkspaces = { ...state.workspaces };
  delete nextWorkspaces[workspaceId];

  const nextWorkspaceIndex = { ...state.workspaceIndex };

  for (const member of Object.values(workspace.members)) {
    if (member?.sessionId) {
      delete nextWorkspaceIndex[toWorkspaceIndexKey(member.provider, member.sessionId)];
    }
  }

  return {
    ...state,
    workspaces: nextWorkspaces,
    workspaceIndex: nextWorkspaceIndex,
  };
}

export function clearWorkspaceProvider(
  state: LocalState,
  workspaceId: string,
  provider: Provider,
): LocalState {
  const workspace = state.workspaces[workspaceId];

  if (!workspace) {
    return state;
  }

  const member = workspace.members[provider];

  const nextMembers = { ...workspace.members };
  if (member) {
    delete nextMembers[provider];
  }

  const nextWorkspaceIndex = { ...state.workspaceIndex };
  if (member?.sessionId) {
    delete nextWorkspaceIndex[toWorkspaceIndexKey(provider, member.sessionId)];
  }

  const enabledProviders = workspace.enabledProviders.filter((item) => item !== provider);

  return {
    ...state,
    workspaces: {
      ...state.workspaces,
      [workspaceId]: {
        ...workspace,
        members: nextMembers,
        enabledProviders,
        updatedAt: Date.now(),
        pendingSource: workspace.pendingSource === provider ? undefined : workspace.pendingSource,
      },
    },
    workspaceIndex: nextWorkspaceIndex,
  };
}

export function setWorkspaceProviderEnabled(
  state: LocalState,
  workspaceId: string,
  provider: Provider,
  enabled: boolean,
): LocalState {
  const workspace = state.workspaces[workspaceId];

  if (!workspace) {
    return state;
  }

  const enabledProviders = enabled
    ? Array.from(new Set([...workspace.enabledProviders, provider]))
    : workspace.enabledProviders.filter((item) => item !== provider);

  return {
    ...state,
    workspaces: {
      ...state.workspaces,
      [workspaceId]: {
        ...workspace,
        enabledProviders,
        updatedAt: Date.now(),
      },
    },
  };
}

export function enforceWorkspaceLimit(
  state: LocalState,
  limit = MAX_WORKSPACES,
): LocalState {
  const count = Object.keys(state.workspaces).length;

  if (count >= limit) {
    throw new Error(`Workspace limit reached (${limit})`);
  }

  return state;
}

export function cleanupPendingWorkspaces(
  state: LocalState,
  sessionState: SessionState,
  now = Date.now(),
  timeoutMs = PENDING_WORKSPACE_TIMEOUT_MS,
): PendingWorkspaceCleanupResult {
  let nextState = state;
  const removedWorkspaceIds: string[] = [];

  for (const workspace of Object.values(state.workspaces)) {
    if (!workspace.pendingSource) {
      continue;
    }

    const sourceMember = workspace.members[workspace.pendingSource];
    const hasBoundSourceSession = Boolean(sourceMember?.sessionId);

    if (hasBoundSourceSession) {
      continue;
    }

    const hasClaimedSourceTab = Boolean(
      sessionState.claimedTabs[toClaimedTabKey(workspace.id, workspace.pendingSource)],
    );
    const hasBoundTargets = Object.entries(workspace.members).some(([provider, member]) => {
      if (!member) {
        return false;
      }

      return provider !== workspace.pendingSource && Boolean(member.sessionId);
    });
    const isTimedOut = now - workspace.createdAt > timeoutMs;

    if (isTimedOut || (!hasClaimedSourceTab && !hasBoundTargets)) {
      nextState = clearWorkspace(nextState, workspace.id);
      removedWorkspaceIds.push(workspace.id);
    }
  }

  return {
    localState: nextState,
    removedWorkspaceIds,
  };
}

export function getWorkspacesOrdered(state: LocalState): Workspace[] {
  return Object.values(state.workspaces).sort((left, right) => right.updatedAt - left.updatedAt);
}
