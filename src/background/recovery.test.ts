import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionState, Workspace } from '../runtime/protocol';
import { reconcileClaimedTabsWithBrowser, waitForContentStatus } from './tab-runtime';
import { resolveDeliveryTarget } from './delivery-targets';
import {
  makeClaimedTab,
  makeConversationRef,
  makeSessionState,
  makeWorkspace,
} from '../test/builders';

describe('recovery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reuses a stale claimed tab when ping succeeds with the expected session', async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      provider: 'deepseek',
      currentUrl: 'https://chat.deepseek.com/a/chat/s/d-1',
      sessionId: 'd-1',
      pageState: 'ready',
      pageKind: 'existing-session',
    });

    vi.stubGlobal('chrome', {
      tabs: {
        sendMessage,
      },
    });

    const workspace: Workspace = makeWorkspace({
      id: 'w1',
      members: {
        deepseek: makeConversationRef('deepseek', 'd-1', 'https://chat.deepseek.com/a/chat/s/d-1'),
      },
      enabledProviders: ['deepseek'],
    });

    const sessionState: SessionState = makeSessionState({
      'w1:deepseek': makeClaimedTab({
        provider: 'deepseek',
        workspaceId: 'w1',
        tabId: 9,
        currentUrl: 'https://chat.deepseek.com/a/chat/s/d-1',
        sessionId: 'd-1',
        lastSeenAt: Date.now() - 240_001,
      }),
    });

    const target = await resolveDeliveryTarget(workspace, 'deepseek', sessionState);

    expect(sendMessage).toHaveBeenCalledWith(9, { type: 'PING' });
    expect(target).toMatchObject({
      tabId: 9,
      expectedSessionId: 'd-1',
      expectedUrl: 'https://chat.deepseek.com/a/chat/s/d-1',
      resolution: 'reuse-claimed-tab',
    });
    expect(target.reason).toContain('stale claimed tab responded ready');
  });

  it('fails immediately when the claimed tab is login-required', async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      provider: 'deepseek',
      currentUrl: 'https://chat.deepseek.com/sign_in',
      sessionId: null,
      pageState: 'login-required',
      pageKind: 'existing-session',
    });
    const update = vi.fn();
    const create = vi.fn();

    vi.stubGlobal('chrome', {
      tabs: {
        sendMessage,
        update,
        create,
      },
    });

    const workspace: Workspace = {
      id: 'w1',
      members: {
        deepseek: {
          provider: 'deepseek',
          sessionId: 'd-1',
          url: 'https://chat.deepseek.com/a/chat/s/d-1',
        },
      },
      enabledProviders: ['deepseek'],
      createdAt: 1,
      updatedAt: 1,
    };

    const sessionState: SessionState = {
      claimedTabs: {
        'w1:deepseek': {
          provider: 'deepseek',
          workspaceId: 'w1',
          tabId: 9,
          currentUrl: 'https://chat.deepseek.com/sign_in',
          sessionId: null,
          pageState: 'login-required',
          lastSeenAt: Date.now(),
        },
      },
    };

    await expect(resolveDeliveryTarget(workspace, 'deepseek', sessionState)).rejects.toThrow(
      'deepseek login required',
    );
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('fails when navigating a claimed tab lands on login-required', async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({
        provider: 'deepseek',
        currentUrl: 'https://chat.deepseek.com/a/chat/s/d-1',
        sessionId: 'wrong-session',
        pageState: 'not-ready',
        pageKind: 'existing-session',
      })
      .mockResolvedValueOnce({
        provider: 'deepseek',
        currentUrl: 'https://chat.deepseek.com/sign_in',
        sessionId: null,
        pageState: 'login-required',
        pageKind: 'existing-session',
      });
    const update = vi.fn().mockResolvedValue({ id: 9 });
    const get = vi.fn().mockResolvedValue({ id: 9, status: 'complete' });

    vi.stubGlobal('chrome', {
      tabs: {
        sendMessage,
        update,
        get,
      },
    });

    const workspace: Workspace = {
      id: 'w1',
      members: {
        deepseek: {
          provider: 'deepseek',
          sessionId: 'd-1',
          url: 'https://chat.deepseek.com/a/chat/s/d-1',
        },
      },
      enabledProviders: ['deepseek'],
      createdAt: 1,
      updatedAt: 1,
    };

    const sessionState: SessionState = {
      claimedTabs: {
        'w1:deepseek': {
          provider: 'deepseek',
          workspaceId: 'w1',
          tabId: 9,
          currentUrl: 'https://chat.deepseek.com/a/chat/s/d-1',
          sessionId: 'd-1',
          pageState: 'ready',
          lastSeenAt: Date.now(),
        },
      },
    };

    await expect(resolveDeliveryTarget(workspace, 'deepseek', sessionState)).rejects.toThrow(
      'deepseek login required',
    );
    expect(update).toHaveBeenCalledWith(9, {
      url: 'https://chat.deepseek.com/a/chat/s/d-1',
      active: false,
    });
  });

  it('fails when a newly opened provider tab is login-required', async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      provider: 'deepseek',
      currentUrl: 'https://chat.deepseek.com/sign_in',
      sessionId: null,
      pageState: 'login-required',
      pageKind: 'existing-session',
    });
    const create = vi.fn().mockResolvedValue({ id: 12 });
    const get = vi.fn().mockResolvedValue({ id: 12, status: 'complete' });

    vi.stubGlobal('chrome', {
      tabs: {
        sendMessage,
        create,
        get,
      },
    });

    const workspace: Workspace = {
      id: 'w1',
      members: {},
      enabledProviders: ['deepseek'],
      createdAt: 1,
      updatedAt: 1,
    };
    const sessionState: SessionState = {
      claimedTabs: {},
    };

    await expect(resolveDeliveryTarget(workspace, 'deepseek', sessionState)).rejects.toThrow(
      'deepseek login required',
    );
    expect(create).toHaveBeenCalledWith({
      url: 'https://chat.deepseek.com',
      active: false,
    });
  });

  it('treats error pages as terminal content status', async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      provider: 'claude',
      currentUrl: 'https://claude.ai/chat/missing',
      sessionId: null,
      pageState: 'error',
      pageKind: 'existing-session',
    });

    vi.stubGlobal('chrome', {
      tabs: {
        sendMessage,
      },
    });

    const status = await waitForContentStatus(12, 'claude', 1_000);

    expect(status).toEqual({
      provider: 'claude',
      currentUrl: 'https://claude.ai/chat/missing',
      sessionId: null,
      pageState: 'error',
      pageKind: 'existing-session',
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(12, { type: 'PING' });
  });

  it('reconciles claimed tabs whose browser tabs are gone', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ id: 1 })
      .mockRejectedValueOnce(new Error('missing'));

    vi.stubGlobal('chrome', {
      tabs: {
        get,
      },
    });

    const sessionState = makeSessionState({
      'w1:claude': makeClaimedTab({ workspaceId: 'w1', provider: 'claude', tabId: 1 }),
      'w1:chatgpt': makeClaimedTab({ workspaceId: 'w1', provider: 'chatgpt', tabId: 2 }),
    });

    const result = await reconcileClaimedTabsWithBrowser(sessionState);

    expect(Object.keys(result.sessionState.claimedTabs)).toEqual(['w1:claude']);
    expect(result.removedClaimedTabs).toHaveLength(1);
    expect(result.removedClaimedTabs[0]?.provider).toBe('chatgpt');
  });
});
