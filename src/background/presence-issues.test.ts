import { describe, expect, it } from 'vitest';
import { makeLocalState, makeWorkspace } from '../test/builders';
import { applyPresenceWorkspaceIssue } from './presence-issues';

describe('applyPresenceWorkspaceIssue', () => {
  it('does not clear delivery issues when a failed target reports a ready new-chat page', () => {
    const state = makeLocalState({
      workspaces: {
        w1: makeWorkspace({
          id: 'w1',
          enabledProviders: ['chatgpt', 'deepseek'],
          memberIssues: {
            deepseek: 'upload-failed',
          },
        }),
      },
    });

    const result = applyPresenceWorkspaceIssue(state, 'w1', 'deepseek', 'ready');

    expect(result.localState.workspaces.w1.memberIssues?.deepseek).toBe('upload-failed');
    expect(result.shouldPersist).toBe(false);
  });

  it('does not clear unconfirmed delivery issues until the target reports a new session', () => {
    const state = makeLocalState({
      workspaces: {
        w1: makeWorkspace({
          id: 'w1',
          enabledProviders: ['chatgpt', 'deepseek'],
          members: {
            deepseek: {
              provider: 'deepseek',
              sessionId: null,
              url: 'https://chat.deepseek.com/',
            },
          },
          memberIssues: {
            deepseek: 'delivery-failed',
          },
        }),
      },
    });

    const result = applyPresenceWorkspaceIssue(state, 'w1', 'deepseek', 'ready', {
      sessionId: null,
      previousMemberSessionId: null,
    });

    expect(result.localState.workspaces.w1.memberIssues?.deepseek).toBe('delivery-failed');
    expect(result.shouldPersist).toBe(false);
  });

  it('clears unconfirmed delivery issues when a pending target reports a new session', () => {
    const state = makeLocalState({
      workspaces: {
        w1: makeWorkspace({
          id: 'w1',
          enabledProviders: ['chatgpt', 'deepseek'],
          members: {
            deepseek: {
              provider: 'deepseek',
              sessionId: 'd-1',
              url: 'https://chat.deepseek.com/a/chat/s/d-1',
            },
          },
          memberIssues: {
            deepseek: 'delivery-failed',
          },
        }),
      },
    });

    const result = applyPresenceWorkspaceIssue(state, 'w1', 'deepseek', 'ready', {
      sessionId: 'd-1',
      previousMemberSessionId: null,
    });

    expect(result.localState.workspaces.w1.memberIssues?.deepseek).toBeUndefined();
    expect(result.shouldPersist).toBe(true);
  });

  it('does not clear delivery issues when an already-bound target reports the same session', () => {
    const state = makeLocalState({
      workspaces: {
        w1: makeWorkspace({
          id: 'w1',
          enabledProviders: ['chatgpt', 'deepseek'],
          members: {
            deepseek: {
              provider: 'deepseek',
              sessionId: 'd-1',
              url: 'https://chat.deepseek.com/a/chat/s/d-1',
            },
          },
          memberIssues: {
            deepseek: 'delivery-failed',
          },
        }),
      },
    });

    const result = applyPresenceWorkspaceIssue(state, 'w1', 'deepseek', 'ready', {
      sessionId: 'd-1',
      previousMemberSessionId: 'd-1',
    });

    expect(result.localState.workspaces.w1.memberIssues?.deepseek).toBe('delivery-failed');
    expect(result.shouldPersist).toBe(false);
  });

  it('still clears transient presence issues when the provider becomes ready', () => {
    const state = makeLocalState({
      workspaces: {
        w1: makeWorkspace({
          id: 'w1',
          enabledProviders: ['chatgpt', 'deepseek'],
          memberIssues: {
            deepseek: 'loading',
          },
        }),
      },
    });

    const result = applyPresenceWorkspaceIssue(state, 'w1', 'deepseek', 'ready');

    expect(result.localState.workspaces.w1.memberIssues?.deepseek).toBeUndefined();
    expect(result.shouldPersist).toBe(true);
  });

  it('marks private-mode pages as presence issues', () => {
    const state = makeLocalState({
      workspaces: {
        w1: makeWorkspace({
          id: 'w1',
          enabledProviders: ['chatgpt', 'deepseek'],
        }),
      },
    });

    const result = applyPresenceWorkspaceIssue(state, 'w1', 'deepseek', 'private-mode');

    expect(result.localState.workspaces.w1.memberIssues?.deepseek).toBe('private-mode');
    expect(result.shouldPersist).toBe(true);
  });
});
