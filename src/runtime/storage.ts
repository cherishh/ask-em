import {
  createDefaultEnabledProviders,
  type DebugLogEntry,
  STORAGE_KEYS,
  type ClaimedTab,
  type LocalState,
  type Provider,
  type SessionState,
} from './protocol';
import { toClaimedTabKey } from './protocol';

export const DEFAULT_LOCAL_STATE: LocalState = {
  globalSyncEnabled: true,
  defaultEnabledProviders: createDefaultEnabledProviders(),
  workspaces: {},
  workspaceIndex: {},
  debugLogs: [],
};

export const DEFAULT_SESSION_STATE: SessionState = {
  claimedTabs: {},
};

type StorageArea = Pick<
  chrome.storage.StorageArea,
  'get' | 'set' | 'remove'
>;

async function readState<T>(area: StorageArea, key: string, fallback: T): Promise<T> {
  const result = await area.get(key);
  return (result[key] as T | undefined) ?? fallback;
}

async function writeState<T>(area: StorageArea, key: string, value: T): Promise<T> {
  await area.set({ [key]: value });
  return value;
}

export async function getLocalState(): Promise<LocalState> {
  return readState(chrome.storage.local, STORAGE_KEYS.local, DEFAULT_LOCAL_STATE);
}

export async function setLocalState(state: LocalState): Promise<LocalState> {
  return writeState(chrome.storage.local, STORAGE_KEYS.local, state);
}

export async function updateLocalState(
  updater: (state: LocalState) => LocalState | Promise<LocalState>,
): Promise<LocalState> {
  const current = await getLocalState();
  const next = await updater(current);
  return setLocalState(next);
}

export async function clearLocalState(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.local);
}

export async function getSessionState(): Promise<SessionState> {
  return readState(chrome.storage.session, STORAGE_KEYS.session, DEFAULT_SESSION_STATE);
}

export async function setSessionState(state: SessionState): Promise<SessionState> {
  return writeState(chrome.storage.session, STORAGE_KEYS.session, state);
}

export async function updateSessionState(
  updater: (state: SessionState) => SessionState | Promise<SessionState>,
): Promise<SessionState> {
  const current = await getSessionState();
  const next = await updater(current);
  return setSessionState(next);
}

export async function clearSessionState(): Promise<void> {
  await chrome.storage.session.remove(STORAGE_KEYS.session);
}

export async function appendDebugLog(entry: Omit<DebugLogEntry, 'id' | 'timestamp'> & Partial<Pick<DebugLogEntry, 'id' | 'timestamp'>>): Promise<LocalState> {
  return updateLocalState((state) => {
    const debugLog: DebugLogEntry = {
      id: entry.id ?? crypto.randomUUID(),
      timestamp: entry.timestamp ?? Date.now(),
      level: entry.level,
      scope: entry.scope,
      provider: entry.provider,
      workspaceId: entry.workspaceId,
      message: entry.message,
      detail: entry.detail,
    };

    return {
      ...state,
      debugLogs: [...state.debugLogs, debugLog].slice(-1000),
    };
  });
}

export async function clearDebugLogs(): Promise<LocalState> {
  return updateLocalState((state) => ({
    ...state,
    debugLogs: [],
  }));
}

export async function upsertClaimedTab(
  workspaceId: string,
  provider: Provider,
  claimedTab: ClaimedTab,
): Promise<SessionState> {
  return updateSessionState((state) => ({
    ...state,
    claimedTabs: {
      ...state.claimedTabs,
      [toClaimedTabKey(workspaceId, provider)]: claimedTab,
    },
  }));
}

export async function clearClaimedTab(
  workspaceId: string,
  provider: Provider,
): Promise<SessionState> {
  return updateSessionState((state) => {
    const nextClaimedTabs = { ...state.claimedTabs };
    delete nextClaimedTabs[toClaimedTabKey(workspaceId, provider)];

    return {
      ...state,
      claimedTabs: nextClaimedTabs,
    };
  });
}
