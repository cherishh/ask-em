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
});
