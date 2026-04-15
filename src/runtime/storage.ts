import {
  createDefaultEnabledProviders,
  DEFAULT_SHORTCUTS,
  type DebugLogEntry,
  STORAGE_KEYS,
  type ClaimedTab,
  type LocalState,
  type Provider,
  type SessionState,
} from './protocol';
import { toClaimedTabKey } from './protocol';
import { rebuildWorkspaceIndex } from './workspace';

export const DEFAULT_LOCAL_STATE: LocalState = {
  globalSyncEnabled: true,
  autoSyncNewChatsEnabled: true,
  debugLoggingEnabled: true,
  showDiagnostics: false,
  closeTabsOnDeleteSet: false,
  defaultEnabledProviders: createDefaultEnabledProviders(),
  shortcuts: DEFAULT_SHORTCUTS,
  workspaces: {},
  workspaceIndex: {},
  debugLogs: [],
};

export const DEFAULT_SESSION_STATE: SessionState = {
  claimedTabs: {},
};

const DEBUG_LOG_LIMIT = 350;

type StorageArea = Pick<
  chrome.storage.StorageArea,
  'get' | 'set' | 'remove'
>;

function createStorageQueue() {
  let tail = Promise.resolve();

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task, task);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}

const localStateQueue = createStorageQueue();
const sessionStateQueue = createStorageQueue();

async function readState<T>(area: StorageArea, key: string, fallback: T): Promise<T> {
  const result = await area.get(key);
  return (result[key] as T | undefined) ?? fallback;
}

async function writeState<T>(area: StorageArea, key: string, value: T): Promise<T> {
  await area.set({ [key]: value });
  return value;
}

function isWorkspaceIndexEqual(left: LocalState['workspaceIndex'], right: LocalState['workspaceIndex']): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);

  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(([key, value]) => right[key] === value);
}

function normalizeLocalState(state: LocalState): LocalState {
  let normalized = state;

  const workspaceIndex = rebuildWorkspaceIndex(normalized.workspaces);

  if (!isWorkspaceIndexEqual(normalized.workspaceIndex, workspaceIndex)) {
    normalized = { ...normalized, workspaceIndex };
  }

  return normalized;
}

export async function getLocalState(): Promise<LocalState> {
  return localStateQueue.run(async () => {
    const state = await readState(chrome.storage.local, STORAGE_KEYS.local, DEFAULT_LOCAL_STATE);
    const normalized = normalizeLocalState(state);

    if (normalized !== state) {
      await writeState(chrome.storage.local, STORAGE_KEYS.local, normalized);
    }

    return normalized;
  });
}

export async function setLocalState(state: LocalState): Promise<LocalState> {
  return localStateQueue.run(async () =>
    writeState(chrome.storage.local, STORAGE_KEYS.local, normalizeLocalState(state)),
  );
}

export async function updateLocalState(
  updater: (state: LocalState) => LocalState | Promise<LocalState>,
): Promise<LocalState> {
  return localStateQueue.run(async () => {
    const current = await readState(chrome.storage.local, STORAGE_KEYS.local, DEFAULT_LOCAL_STATE);
    const normalizedCurrent = normalizeLocalState(current);

    if (normalizedCurrent !== current) {
      await writeState(chrome.storage.local, STORAGE_KEYS.local, normalizedCurrent);
    }

    const next = await updater(normalizedCurrent);
    return writeState(chrome.storage.local, STORAGE_KEYS.local, normalizeLocalState(next));
  });
}

export async function clearLocalState(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.local);
}

export async function getSessionState(): Promise<SessionState> {
  return sessionStateQueue.run(async () =>
    readState(chrome.storage.session, STORAGE_KEYS.session, DEFAULT_SESSION_STATE),
  );
}

export async function setSessionState(state: SessionState): Promise<SessionState> {
  return sessionStateQueue.run(async () =>
    writeState(chrome.storage.session, STORAGE_KEYS.session, state),
  );
}

export async function updateSessionState(
  updater: (state: SessionState) => SessionState | Promise<SessionState>,
): Promise<SessionState> {
  return sessionStateQueue.run(async () => {
    const current = await readState(chrome.storage.session, STORAGE_KEYS.session, DEFAULT_SESSION_STATE);
    const next = await updater(current);
    return writeState(chrome.storage.session, STORAGE_KEYS.session, next);
  });
}

export async function clearSessionState(): Promise<void> {
  await chrome.storage.session.remove(STORAGE_KEYS.session);
}

export async function appendDebugLog(entry: Omit<DebugLogEntry, 'id' | 'timestamp'> & Partial<Pick<DebugLogEntry, 'id' | 'timestamp'>>): Promise<LocalState> {
  return updateLocalState((state) => {
    if (!state.debugLoggingEnabled) {
      return state;
    }

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
      debugLogs: [...state.debugLogs, debugLog].slice(-DEBUG_LOG_LIMIT),
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
