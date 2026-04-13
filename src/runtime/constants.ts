import type { DefaultEnabledProviders, Provider } from './types';

export const MAX_WORKSPACES = 3;

export const PENDING_WORKSPACE_TIMEOUT_MS = 30_000;

export const HEARTBEAT_STALE_MS = 240_000;

export const STORAGE_KEYS = {
  local: 'ask-em-local-state',
  session: 'ask-em-session-state',
  indicatorPositions: 'ask-em-indicator-positions',
} as const;

export const ALL_PROVIDERS: Provider[] = ['claude', 'chatgpt', 'gemini', 'deepseek', 'manus'];

export const DEFAULT_ENABLED_PROVIDER_LIST: Provider[] = ALL_PROVIDERS.filter(
  (provider) => provider !== 'manus',
);

export function createDefaultEnabledProviders(
  enabledProviders: Provider[] = DEFAULT_ENABLED_PROVIDER_LIST,
): DefaultEnabledProviders {
  return {
    claude: enabledProviders.includes('claude'),
    chatgpt: enabledProviders.includes('chatgpt'),
    gemini: enabledProviders.includes('gemini'),
    deepseek: enabledProviders.includes('deepseek'),
    manus: enabledProviders.includes('manus'),
  };
}

export function toWorkspaceIndexKey(provider: Provider, sessionId: string): string {
  return `${provider}:${sessionId}`;
}

export function toClaimedTabKey(workspaceId: string, provider: Provider): string {
  return `${workspaceId}:${provider}`;
}
