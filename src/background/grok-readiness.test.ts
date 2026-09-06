import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroupMemberState, PageState } from '../runtime/protocol';
import { getLocalState, getSessionState, setLocalState, updateLocalState } from '../runtime/storage';
import { makeClaimedTab, makeLocalState, makeSessionState, makeSubmitMessage, makeWorkspace } from '../test/builders';
import { getWorkspaceProviderDisplay } from '../utils/workspace-provider-display';
import { attemptProviderDelivery } from './delivery-executor';
import { applyDeliveryResultsToWorkspaceIssues } from './delivery-issues';
import { resolveDeliveryTarget } from './delivery-targets';
import { handlePresenceMessage } from './presence';
import { buildWorkspaceSummary } from './status';

function memoryStorage() {
  const data: Record<string, unknown> = {};
  return {
    get: vi.fn(async (key: string) => ({ [key]: structuredClone(data[key]) })),
    set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(data, structuredClone(values)); }),
  };
}

const workspace = makeWorkspace({ id: 'w1', members: {}, enabledProviders: ['claude', 'grok'] });

function mockGrok(readyAt: number, terminalState: PageState = 'ready') {
  const create = vi.fn().mockResolvedValue({ id: 42 });
  const deliver = vi.fn().mockResolvedValue({ ok: true, accepted: true, confirmed: true });
  const sendMessage = vi.fn(async (tabId: number, message: { type: string }) => {
    if (message.type === 'DELIVER_PROMPT') return deliver(tabId, message);
    return {
      provider: 'grok', currentUrl: 'https://grok.com/', sessionId: null,
      pageKind: 'new-chat', pageState: Date.now() >= readyAt ? terminalState : 'not-ready',
    };
  });
  vi.stubGlobal('chrome', {
    storage: { local: memoryStorage(), session: memoryStorage() },
    tabs: {
      create,
      get: vi.fn().mockResolvedValue({ id: 42, status: 'complete' }),
      update: vi.fn().mockResolvedValue({ id: 42 }),
      sendMessage,
    },
  });
  return { create, deliver, sendMessage };
}

function attempt(sessionState = makeSessionState()) {
  return attemptProviderDelivery({
    workspace, workspaceId: 'w1', provider: 'grok',
    message: makeSubmitMessage(), sessionState,
  });
}

describe('Grok delayed readiness from the September 6 trace', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps the opened new-chat target until its editor is ready at 19 seconds', async () => {
    const create = vi.fn().mockResolvedValue({ id: 42 });
    vi.stubGlobal('chrome', {
      tabs: {
        create,
        get: vi.fn().mockResolvedValue({ id: 42, status: 'complete' }),
        sendMessage: vi.fn(async () => ({
          provider: 'grok', currentUrl: 'https://grok.com/', sessionId: null,
          pageKind: 'new-chat', pageState: Date.now() >= 19_000 ? 'ready' : 'not-ready',
        })),
      },
    });
    const workspace = makeWorkspace({ id: 'w1', members: {}, enabledProviders: ['grok'] });
    const outcome = resolveDeliveryTarget(workspace, 'grok', makeSessionState())
      .then((target) => ({ target, error: null }), (error: Error) => ({ target: null, error: error.message }));

    await vi.advanceTimersByTimeAsync(19_250);
    expect(await outcome).toMatchObject({ target: { tabId: 42, resolution: 'open-new-tab' }, error: null });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('associates the new tab while loading, then delivers exactly once when ready', async () => {
    const { deliver, create } = mockGrok(19_000);
    await setLocalState(makeLocalState({ workspaces: { w1: workspace } }));
    const result = attempt();

    await vi.advanceTimersByTimeAsync(500);
    expect((await getSessionState()).claimedTabs['w1:grok']).toMatchObject({ tabId: 42, pageState: 'not-ready' });
    expect(deliver).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(18_500);
    expect(await result).toMatchObject({ provider: 'grok', ok: true, confirmed: true });
    expect(deliver).toHaveBeenCalledExactlyOnceWith(42, expect.objectContaining({
      type: 'DELIVER_PROMPT', content: 'hello', workspaceId: 'w1',
    }));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('waits on a claimed new-chat tab instead of opening a second one', async () => {
    const { deliver, create } = mockGrok(19_000);
    const result = attempt(makeSessionState({
      'w1:grok': makeClaimedTab({
        workspaceId: 'w1', provider: 'grok', tabId: 42,
        currentUrl: 'https://grok.com/', pageState: 'not-ready',
      }),
    }));
    await vi.advanceTimersByTimeAsync(19_000);
    expect(await result).toMatchObject({ ok: true });
    expect(create).not.toHaveBeenCalled();
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it.each(['before', 'after'] as const)('keeps a timeout visible when ready arrives %s results are persisted', async (readyOrder) => {
    const { deliver } = mockGrok(Infinity);
    await setLocalState(makeLocalState({ workspaces: { w1: workspace } }));
    let settled = false;
    const resultPromise = attempt().then(result => { settled = true; return result; });
    await vi.advanceTimersByTimeAsync(39_750);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(250);
    const result = await resultPromise;
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('timed out after 40s') });
    expect(deliver).not.toHaveBeenCalled();
    const persistResult = () => updateLocalState(state => applyDeliveryResultsToWorkspaceIssues(state, 'w1', [result]));
    if (readyOrder === 'after') await persistResult();

    const presence = await handlePresenceMessage({
      type: 'HEARTBEAT', provider: 'grok', pageState: 'ready', pageKind: 'new-chat',
      currentUrl: 'https://grok.com/', sessionId: null, timestamp: 40_250,
    }, { tab: { id: 42 } } as chrome.runtime.MessageSender);
    expect(presence).toMatchObject({ workspaceId: 'w1' });
    if (readyOrder === 'before') await persistResult();
    const localState = await getLocalState();
    const summary = buildWorkspaceSummary(localState.workspaces.w1, await getSessionState());
    expect(summary.memberIssues.grok).toBe('delivery-failed');
    expect(getWorkspaceProviderDisplay({
      memberIssue: summary.memberIssues.grok, memberState: summary.memberStates.grok as GroupMemberState,
      hasMember: false, enabled: true, globalSyncEnabled: true,
    }).kind).toBe('needs-attention');
    expect(deliver).not.toHaveBeenCalled();
  });

  it('continues polling while the new tab has no content script yet', async () => {
    const { deliver, sendMessage } = mockGrok(19_000);
    const original = sendMessage.getMockImplementation()!;
    sendMessage.mockImplementation((...args) => {
      if (Date.now() < 19_000) return Promise.reject(new Error('Receiving end does not exist'));
      return original(...args);
    });
    const result = attempt();
    await vi.advanceTimersByTimeAsync(19_000);
    expect(await result).toMatchObject({ ok: true });
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it.each(['g-1', 'foreign-session'])('validates the bound session after delayed navigation to %s', async (sessionId) => {
    const { deliver, sendMessage, create } = mockGrok(19_000);
    sendMessage.mockImplementation(async (tabId, message) => {
      if (message.type === 'DELIVER_PROMPT') return deliver(tabId, message);
      return {
        provider: 'grok', currentUrl: `https://grok.com/c/${sessionId}`, sessionId,
        pageKind: 'existing-session', pageState: Date.now() >= 19_000 ? 'ready' : 'not-ready',
      };
    });
    const result = attemptProviderDelivery({
      workspace: makeWorkspace({
        ...workspace,
        members: { grok: { provider: 'grok', sessionId: 'g-1', url: 'https://grok.com/c/g-1' } },
      }),
      workspaceId: 'w1', provider: 'grok', message: makeSubmitMessage(),
      sessionState: makeSessionState({
        'w1:grok': makeClaimedTab({ workspaceId: 'w1', provider: 'grok', tabId: 42 }),
      }),
    });
    await vi.advanceTimersByTimeAsync(19_000);
    expect(chrome.tabs.update).toHaveBeenCalledWith(42, { url: 'https://grok.com/c/g-1', active: false });
    expect(create).not.toHaveBeenCalled();
    if (sessionId === 'g-1') {
      expect(await result).toMatchObject({ ok: true });
      expect(deliver).toHaveBeenCalledTimes(1);
    } else {
      expect(await result).toMatchObject({ ok: false, reason: 'grok session mismatch' });
      expect(deliver).not.toHaveBeenCalled();
    }
  });

  it('does not mistake the old document for the destination while navigation is loading', async () => {
    const { deliver, sendMessage } = mockGrok(19_000);
    let loaded = false;
    const listeners = new Set<(id: number, change: { status: string }) => void>();
    Object.assign(chrome.tabs, {
      onUpdated: {
        addListener: vi.fn(listener => listeners.add(listener)),
        removeListener: vi.fn(listener => listeners.delete(listener)),
      },
    });
    vi.mocked(chrome.tabs.get).mockImplementation(async () => ({ id: 42, status: loaded ? 'complete' : 'loading' }) as chrome.tabs.Tab);
    sendMessage.mockImplementation(async (tabId, message) => {
      if (message.type === 'DELIVER_PROMPT') return deliver(tabId, message);
      return {
        provider: 'grok', currentUrl: `https://grok.com/c/${loaded ? 'g-1' : 'old-session'}`,
        sessionId: loaded ? 'g-1' : 'old-session', pageKind: 'existing-session',
        pageState: !loaded || Date.now() >= 19_000 ? 'ready' : 'not-ready',
      };
    });
    const result = attemptProviderDelivery({
      workspace: makeWorkspace({
        ...workspace,
        members: { grok: { provider: 'grok', sessionId: 'g-1', url: 'https://grok.com/c/g-1' } },
      }),
      workspaceId: 'w1', provider: 'grok', message: makeSubmitMessage(),
      sessionState: makeSessionState({
        'w1:grok': makeClaimedTab({ workspaceId: 'w1', provider: 'grok', tabId: 42 }),
      }),
    });
    await vi.advanceTimersByTimeAsync(2_000);
    loaded = true;
    for (const listener of listeners) listener(42, { status: 'complete' });
    await vi.advanceTimersByTimeAsync(17_000);
    expect(await result).toMatchObject({ ok: true });
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['login-required', 'login required'], ['error', 'error page'],
    ['private-mode', 'private chat'], ['read-only', 'read-only page'],
  ] as const)('stops immediately on %s without sending', async (pageState, reason) => {
    const { deliver } = mockGrok(0, pageState);
    expect(await attempt()).toMatchObject({ ok: false, reason: `grok ${reason}` });
    expect(Date.now()).toBe(0);
    expect(deliver).not.toHaveBeenCalled();
  });
});
