export type Provider = 'claude' | 'chatgpt' | 'gemini' | 'deepseek';

export type PageState = 'ready' | 'login-required' | 'not-ready';

export type PageKind = 'new-chat' | 'existing-session';

export type ProviderStatus = {
  provider: Provider;
  currentUrl: string;
  sessionId: string | null;
  pageKind: PageKind;
  pageState: PageState;
  mounted: boolean;
};

export type ConversationRef = {
  provider: Provider;
  sessionId: string | null;
  url: string;
};

export type Workspace = {
  id: string;
  members: Partial<Record<Provider, ConversationRef>>;
  enabledProviders: Provider[];
  createdAt: number;
  updatedAt: number;
  pendingSource?: Provider;
};

export type WorkspaceIndex = Record<string, string>;

export type ClaimedTab = {
  provider: Provider;
  workspaceId: string;
  tabId: number;
  lastSeenAt: number;
  pageState: PageState;
  currentUrl: string;
  sessionId: string | null;
};

export type LocalState = {
  globalSyncEnabled: boolean;
  workspaces: Record<string, Workspace>;
  workspaceIndex: WorkspaceIndex;
};

export type SessionState = {
  claimedTabs: Record<string, ClaimedTab>;
};

export type HelloMessage = {
  type: 'HELLO';
  provider: Provider;
  currentUrl: string;
  sessionId: string | null;
  pageState: PageState;
  pageKind: PageKind;
};

export type HeartbeatMessage = {
  type: 'HEARTBEAT';
  provider: Provider;
  currentUrl: string;
  sessionId: string | null;
  pageState: PageState;
  pageKind: PageKind;
  visibilityState: DocumentVisibilityState;
  timestamp: number;
};

export type UserSubmitMessage = {
  type: 'USER_SUBMIT';
  provider: Provider;
  currentUrl: string;
  sessionId: string | null;
  pageKind: PageKind;
  content: string;
  timestamp: number;
};

export type DeliverPromptMessage = {
  type: 'DELIVER_PROMPT';
  workspaceId: string;
  provider: Provider;
  content: string;
  expectedSessionId: string | null;
  expectedUrl: string | null;
  timestamp: number;
};

export type PingMessage = {
  type: 'PING';
};

export type PingResponseMessage = {
  type: 'PING_RESPONSE';
  provider: Provider;
  currentUrl: string;
  sessionId: string | null;
  pageState: PageState;
  pageKind: PageKind;
};

export type GetStatusMessage = {
  type: 'GET_STATUS';
};

export type WorkspaceSummary = {
  workspace: Workspace;
  memberStatuses: Partial<Record<Provider, 'healthy' | 'stale' | 'missing' | 'pending'>>;
};

export type StatusResponseMessage = {
  type: 'STATUS_RESPONSE';
  globalSyncEnabled: boolean;
  workspaceLimit: number;
  workspaces: WorkspaceSummary[];
};

export type ClearWorkspaceMessage = {
  type: 'CLEAR_WORKSPACE';
  workspaceId: string;
};

export type ClearWorkspaceProviderMessage = {
  type: 'CLEAR_WORKSPACE_PROVIDER';
  workspaceId: string;
  provider: Provider;
};

export type RuntimeMessage =
  | HelloMessage
  | HeartbeatMessage
  | UserSubmitMessage
  | DeliverPromptMessage
  | PingMessage
  | PingResponseMessage
  | GetStatusMessage
  | ClearWorkspaceMessage
  | ClearWorkspaceProviderMessage
  | StatusResponseMessage;

export const MAX_WORKSPACES = 3;

export const PENDING_WORKSPACE_TIMEOUT_MS = 30_000;

export const HEARTBEAT_STALE_MS = 45_000;

export const STORAGE_KEYS = {
  local: 'ask-em-local-state',
  session: 'ask-em-session-state',
} as const;

export function toWorkspaceIndexKey(provider: Provider, sessionId: string): string {
  return `${provider}:${sessionId}`;
}

export function toClaimedTabKey(workspaceId: string, provider: Provider): string {
  return `${workspaceId}:${provider}`;
}

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return 'type' in value;
}
