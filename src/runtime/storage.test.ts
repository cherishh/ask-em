import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DebugLogEntry, LocalState, SessionState } from './protocol';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function createStorageArea() {
  const state = new Map<string, unknown>();

  return {
    state,
    area: {
      async get(key: string) {
        return { [key]: state.get(key) };
      },
      async set(value: Record<string, unknown>) {
        for (const [key, nextValue] of Object.entries(value)) {
          state.set(key, nextValue);
        }
      },
      async remove(key: string) {
        state.delete(key);
      },
    } as any,
  };
}

describe('storage update queues', () => {
  beforeEach(() => {
    vi.resetModules();

    const local = createStorageArea();
    const session = createStorageArea();

    vi.stubGlobal('chrome', {
      storage: {
        local: local.area,
        session: session.area,
      },
    });
  });

  it('serializes local state updates so debug logs are not lost under concurrent writes', async () => {
    const storage = await import('./storage');
    const deferred = createDeferred<LocalState>();

    await storage.setLocalState({
      ...storage.DEFAULT_LOCAL_STATE,
      debugLoggingEnabled: true,
    });

    const first = storage.updateLocalState(async (state) => {
      const next = await deferred.promise;
      return {
        ...state,
        debugLogs: [...state.debugLogs, ...next.debugLogs],
      };
    });

    const second = storage.appendDebugLog({
      id: 'log-2',
      timestamp: 2,
      level: 'info',
      scope: 'background',
      message: 'second',
    });

    deferred.resolve({
      ...storage.DEFAULT_LOCAL_STATE,
      debugLoggingEnabled: true,
      debugLogs: [
        {
          id: 'log-1',
          timestamp: 1,
          level: 'info',
          scope: 'background',
          message: 'first',
        } satisfies DebugLogEntry,
      ],
    });

    await Promise.all([first, second]);

    const finalState = await storage.getLocalState();
    expect(finalState.debugLogs.map((log) => log.id)).toEqual(['log-1', 'log-2']);
  });

  it('serializes session state updates so concurrent claimed-tab writes are merged', async () => {
    const storage = await import('./storage');
    const deferred = createDeferred<SessionState>();

    await storage.setSessionState(storage.DEFAULT_SESSION_STATE);

    const first = storage.updateSessionState(async (state) => {
      const next = await deferred.promise;
      return {
        ...state,
        claimedTabs: {
          ...state.claimedTabs,
          ...next.claimedTabs,
        },
      };
    });

    const second = storage.upsertClaimedTab('w2', 'chatgpt', {
      provider: 'chatgpt',
      workspaceId: 'w2',
      tabId: 22,
      lastSeenAt: 22,
      pageState: 'ready',
      currentUrl: 'https://chatgpt.com/c/g-2',
      sessionId: 'g-2',
    });

    deferred.resolve({
      claimedTabs: {
        'w1:claude': {
          provider: 'claude',
          workspaceId: 'w1',
          tabId: 11,
          lastSeenAt: 11,
          pageState: 'ready',
          currentUrl: 'https://claude.ai/chat/c-1',
          sessionId: 'c-1',
        },
      },
    });

    await Promise.all([first, second]);

    const finalState = await storage.getSessionState();
    expect(Object.keys(finalState.claimedTabs).sort()).toEqual(['w1:claude', 'w2:chatgpt']);
  });
});
