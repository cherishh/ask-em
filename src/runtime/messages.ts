import type { ShortcutConfig } from './shortcuts';
import type {
  DebugLogEntry,
  DefaultEnabledProviders,
  PageKind,
  PageState,
  Provider,
  WorkspaceSummary,
} from './types';

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

export type SyncProgressMessage = {
  type: 'SYNC_PROGRESS';
  workspaceId: string;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
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

export type StatusResponseMessage = {
  type: 'STATUS_RESPONSE';
  globalSyncEnabled: boolean;
  debugLoggingEnabled: boolean;
  closeTabsOnDeleteSet: boolean;
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

export type SetCloseTabsOnDeleteSetMessage = {
  type: 'SET_CLOSE_TABS_ON_DELETE_SET';
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

export type SwitchProviderTabMessage = {
  type: 'SWITCH_PROVIDER_TAB';
  provider: Provider;
  direction: 'next' | 'previous';
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
  | SyncProgressMessage
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
  | SetCloseTabsOnDeleteSetMessage
  | SetShortcutsMessage
  | SwitchProviderTabMessage
  | SetDebugLoggingEnabledMessage
  | DebugLogMessage
  | RefreshContentContextMessage
  | DebugLogsResponseMessage
  | WorkspaceContextResponseMessage
  | StatusResponseMessage;

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return 'type' in value;
}
