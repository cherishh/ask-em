export type Provider = 'claude' | 'chatgpt' | 'gemini' | 'deepseek';

export type PageState = 'ready' | 'login-required' | 'not-ready';

export type PageKind = 'new-chat' | 'existing-session';

export type ProviderStatus = {
  provider: Provider;
  currentUrl: string;
  sessionId: string | null;
  pageKind: PageKind;
  pageState: PageState;
};

export type ConversationRef = {
  provider: Provider;
  sessionId: string | null;
  url: string;
};

export type Workspace = {
  id: string;
  label?: string;
  members: Partial<Record<Provider, ConversationRef>>;
  enabledProviders: Provider[];
  createdAt: number;
  updatedAt: number;
  pendingSource?: Provider;
};

export type DefaultEnabledProviders = Record<Provider, boolean>;

export type ShortcutBinding = {
  key: string;
  meta: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
};

export type ShortcutId = 'togglePageParticipation';

export type ShortcutConfig = Record<ShortcutId, ShortcutBinding>;

export const DEFAULT_SHORTCUTS: ShortcutConfig = {
  togglePageParticipation: { key: '.', meta: false, ctrl: true, shift: false, alt: false },
};

export function formatShortcutDisplay(binding: ShortcutBinding, isApple: boolean): string {
  const parts: string[] = [];
  if (binding.ctrl || binding.meta) parts.push(isApple ? '⌘' : 'Ctrl');
  if (binding.alt) parts.push(isApple ? '⌥' : 'Alt');
  if (binding.shift) parts.push('Shift');
  parts.push(binding.key === ' ' ? 'Space' : binding.key.length === 1 ? binding.key.toUpperCase() : binding.key);
  return parts.join(' + ');
}

export type DebugLogEntry = {
  id: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  scope: 'background' | 'content';
  provider?: Provider;
  workspaceId?: string;
  message: string;
  detail?: string;
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
  debugLoggingEnabled: boolean;
  defaultEnabledProviders: DefaultEnabledProviders;
  shortcuts: ShortcutConfig;
  workspaces: Record<string, Workspace>;
  workspaceIndex: WorkspaceIndex;
  debugLogs: DebugLogEntry[];
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

export type ProviderDeliveryResult = {
  provider: Provider;
  ok: boolean;
  blocked?: boolean;
  reason?: string;
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
  memberStates: Partial<Record<Provider, GroupMemberState>>;
};

export type GroupMemberState =
  | 'ready'
  | 'login-required'
  | 'not-ready'
  | 'stale'
  | 'inactive'
  | 'pending';

export type StatusResponseMessage = {
  type: 'STATUS_RESPONSE';
  globalSyncEnabled: boolean;
  debugLoggingEnabled: boolean;
  workspaceLimit: number;
  defaultEnabledProviders: DefaultEnabledProviders;
  shortcuts: ShortcutConfig;
  workspaces: WorkspaceSummary[];
  recentLogs: DebugLogEntry[];
};

export type GetDebugLogsMessage = {
  type: 'GET_DEBUG_LOGS';
};

export type GetWorkspaceContextMessage = {
  type: 'GET_WORKSPACE_CONTEXT';
  workspaceId: string;
};

export type WorkspaceContextResponseMessage = {
  type: 'WORKSPACE_CONTEXT_RESPONSE';
  globalSyncEnabled: boolean;
  workspaceSummary: WorkspaceSummary | null;
};

export type DebugLogsResponseMessage = {
  type: 'DEBUG_LOGS_RESPONSE';
  logs: DebugLogEntry[];
};

export type ClearDebugLogsMessage = {
  type: 'CLEAR_DEBUG_LOGS';
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

export type SetDefaultEnabledProvidersMessage = {
  type: 'SET_DEFAULT_ENABLED_PROVIDERS';
  providers: Provider[];
};

export type SetWorkspaceProviderEnabledMessage = {
  type: 'SET_WORKSPACE_PROVIDER_ENABLED';
  workspaceId: string;
  provider: Provider;
  enabled: boolean;
};

export type SetDebugLoggingEnabledMessage = {
  type: 'SET_DEBUG_LOGGING_ENABLED';
  enabled: boolean;
};

export type SetGlobalSyncEnabledMessage = {
  type: 'SET_GLOBAL_SYNC_ENABLED';
  enabled: boolean;
};

export type SetShortcutsMessage = {
  type: 'SET_SHORTCUTS';
  shortcuts: ShortcutConfig;
};

export type DebugLogMessage = {
  type: 'LOG_DEBUG';
  level: DebugLogEntry['level'];
  scope: DebugLogEntry['scope'];
  provider?: Provider;
  workspaceId?: string;
  message: string;
  detail?: string;
};

export type RefreshContentContextMessage = {
  type: 'REFRESH_CONTENT_CONTEXT';
};

export type RuntimeMessage =
  | HelloMessage
  | HeartbeatMessage
  | UserSubmitMessage
  | DeliverPromptMessage
  | PingMessage
  | PingResponseMessage
  | GetStatusMessage
  | GetDebugLogsMessage
  | GetWorkspaceContextMessage
  | ClearWorkspaceMessage
  | ClearWorkspaceProviderMessage
  | ClearDebugLogsMessage
  | SetDefaultEnabledProvidersMessage
  | SetWorkspaceProviderEnabledMessage
  | SetGlobalSyncEnabledMessage
  | SetShortcutsMessage
  | SetDebugLoggingEnabledMessage
  | DebugLogMessage
  | RefreshContentContextMessage
  | DebugLogsResponseMessage
  | WorkspaceContextResponseMessage
  | StatusResponseMessage;

export const MAX_WORKSPACES = 3;

export const PENDING_WORKSPACE_TIMEOUT_MS = 30_000;

export const HEARTBEAT_STALE_MS = 240_000;

export const STORAGE_KEYS = {
  local: 'ask-em-local-state',
  session: 'ask-em-session-state',
} as const;

export const ALL_PROVIDERS: Provider[] = ['claude', 'chatgpt', 'gemini', 'deepseek'];

export function createDefaultEnabledProviders(
  enabledProviders: Provider[] = ALL_PROVIDERS,
): DefaultEnabledProviders {
  return {
    claude: enabledProviders.includes('claude'),
    chatgpt: enabledProviders.includes('chatgpt'),
    gemini: enabledProviders.includes('gemini'),
    deepseek: enabledProviders.includes('deepseek'),
  };
}

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
