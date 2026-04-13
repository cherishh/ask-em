import {
  createDefaultEnabledProviders,
  DEFAULT_SHORTCUTS,
  type ClaimedTab,
  type ConversationRef,
  type LocalState,
  type Provider,
  type SessionState,
  type UserSubmitMessage,
  type Workspace,
} from '../runtime/protocol';

export function makeConversationRef(
  provider: Provider,
  sessionId: string | null,
  url: string,
): ConversationRef {
  return {
    provider,
    sessionId,
    url,
  };
}

export function makeWorkspace(overrides: Partial<Workspace> & Pick<Workspace, 'id'>): Workspace {
  return {
    id: overrides.id,
    members: overrides.members ?? {},
    enabledProviders: overrides.enabledProviders ?? [],
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? overrides.createdAt ?? 1,
    label: overrides.label,
    pendingSource: overrides.pendingSource,
  };
}

export function makeLocalState(overrides: Partial<LocalState> = {}): LocalState {
  return {
    globalSyncEnabled: true,
    debugLoggingEnabled: true,
    closeTabsOnDeleteSet: false,
    defaultEnabledProviders: createDefaultEnabledProviders(),
    shortcuts: DEFAULT_SHORTCUTS,
    workspaces: {},
    workspaceIndex: {},
    debugLogs: [],
    ...overrides,
  };
}

export function makeClaimedTab(overrides: Partial<ClaimedTab> & {
  provider: Provider;
  workspaceId: string;
  tabId: number;
}): ClaimedTab {
  return {
    provider: overrides.provider,
    workspaceId: overrides.workspaceId,
    tabId: overrides.tabId,
    lastSeenAt: overrides.lastSeenAt ?? 10,
    pageState: overrides.pageState ?? 'ready',
    currentUrl: overrides.currentUrl ?? '',
    sessionId: overrides.sessionId ?? null,
  };
}

export function makeSessionState(
  claimedTabs: SessionState['claimedTabs'] = {},
): SessionState {
  return {
    claimedTabs,
  };
}

export function makeSubmitMessage(overrides: Partial<UserSubmitMessage> = {}): UserSubmitMessage {
  return {
    type: 'USER_SUBMIT',
    provider: 'claude',
    currentUrl: 'https://claude.ai/chat/c-set',
    sessionId: 'c-set',
    pageKind: 'existing-session',
    content: 'hello',
    timestamp: 100,
    ...overrides,
  };
}
