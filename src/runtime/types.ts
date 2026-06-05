import type { ShortcutConfig } from './shortcuts';

export type Provider = 'claude' | 'chatgpt' | 'gemini' | 'deepseek' | 'manus';

export type PageState = 'ready' | 'login-required' | 'not-ready' | 'error' | 'private-mode';

export type PageKind = 'new-chat' | 'existing-session';

export type ProviderStatus = {
  provider: Provider;
  currentUrl: string;
  sessionId: string | null;
  pageKind: PageKind;
  pageState: PageState;
  authRule?: string;
  authSignalSummary?: string;
};

export type AttachmentRef = {
  id: string;
  name: string;
  mime: string;
  size: number;
};

export type CapturedAttachment = AttachmentRef & {
  file: File;
  source: 'paste' | 'pasted-text' | 'drop' | 'file-input' | 'transient-file-input';
};

export type UploadCapability = {
  maxFiles: number;
} | null;

export type ConversationRef = {
  provider: Provider;
  sessionId: string | null;
  url: string;
};

export type Workspace = {
  id: string;
  label?: string;
  members: Partial<Record<Provider, ConversationRef>>;
  memberIssues?: Partial<Record<Provider, WorkspaceIssue>>;
  enabledProviders: Provider[];
  createdAt: number;
  updatedAt: number;
  pendingSource?: Provider;
};

export type WorkspaceIssue =
  | 'needs-login'
  | 'loading'
  | 'delivery-failed'
  | 'upload-failed'
  | 'error-page'
  | 'private-mode'
  | 'attachment-limit'
  | 'unsupported-attachment';

export type DefaultEnabledProviders = Record<Provider, boolean>;

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
  autoSyncNewChatsEnabled: boolean;
  pauseAfterFirstFanOutEnabled: boolean;
  debugLoggingEnabled: boolean;
  showDiagnostics: boolean;
  closeTabsOnDeleteSet: boolean;
  defaultEnabledProviders: DefaultEnabledProviders;
  defaultFanOutProviders?: Provider[] | null;
  shortcuts: ShortcutConfig;
  workspaces: Record<string, Workspace>;
  workspaceIndex: WorkspaceIndex;
  debugLogs: DebugLogEntry[];
};

export type SessionState = {
  claimedTabs: Record<string, ClaimedTab>;
};

export type WorkspaceSummary = {
  workspace: Workspace;
  memberStates: Partial<Record<Provider, GroupMemberState>>;
  memberIssues: Partial<Record<Provider, WorkspaceIssue | null>>;
};

export type GroupMemberState =
  | 'ready'
  | 'login-required'
  | 'not-ready'
  | 'error'
  | 'private-mode'
  | 'inactive'
  | 'pending';
