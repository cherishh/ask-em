import type { DefaultEnabledProviders, Provider } from './types';

export const MAX_WORKSPACES = 3;

export const PENDING_WORKSPACE_TIMEOUT_MS = 30_000;

export const HEARTBEAT_STALE_MS = 240_000;

// Toggle the default visibility of the Diagnostics card for fresh installs and
// reset storage. Existing explicit user choices are preserved.
export const DEFAULT_SHOW_DIAGNOSTICS = false;

export const STORAGE_KEYS = {
  local: 'ask-em-local-state',
  session: 'ask-em-session-state',
  indicatorPositions: 'ask-em-indicator-positions',
  attachments: 'ask-em-attachment-metadata',
} as const;

export const ATTACHMENT_MAX_AGE_MS = 10 * 60 * 1000;

export const ATTACHMENT_SESSION_BUDGET_BYTES = 50 * 1024 * 1024;

export const ATTACHMENT_MAX_FILE_BYTES = 25 * 1024 * 1024;

export const ATTACHMENT_MAX_COUNT = 20;

export const ATTACHMENT_CHUNK_BYTES = 256 * 1024;

export const ALL_PROVIDERS: Provider[] = ['claude', 'chatgpt', 'gemini', 'kimi', 'grok', 'deepseek', 'manus'];

export const DEFAULT_POPUP_PROVIDER_ORDER: Provider[] = [...ALL_PROVIDERS];

export function normalizePopupProviderOrder(
  providerOrder: readonly Provider[] | null | undefined,
): Provider[] {
  const normalized: Provider[] = [];

  for (const provider of providerOrder ?? []) {
    if (ALL_PROVIDERS.includes(provider) && !normalized.includes(provider)) {
      normalized.push(provider);
    }
  }

  for (const provider of ALL_PROVIDERS) {
    if (!normalized.includes(provider)) {
      normalized.push(provider);
    }
  }

  return normalized;
}

export const DEFAULT_ENABLED_PROVIDER_LIST: Provider[] = ['claude', 'chatgpt'];

export function createDefaultEnabledProviders(
  enabledProviders: Provider[] = DEFAULT_ENABLED_PROVIDER_LIST,
): DefaultEnabledProviders {
  return {
    claude: enabledProviders.includes('claude'),
    chatgpt: enabledProviders.includes('chatgpt'),
    gemini: enabledProviders.includes('gemini'),
    kimi: enabledProviders.includes('kimi'),
    deepseek: enabledProviders.includes('deepseek'),
    manus: enabledProviders.includes('manus'),
    grok: enabledProviders.includes('grok'),
  };
}

export function toWorkspaceIndexKey(provider: Provider, sessionId: string): string {
  return `${provider}:${sessionId}`;
}

export function toClaimedTabKey(workspaceId: string, provider: Provider): string {
  return `${workspaceId}:${provider}`;
}
