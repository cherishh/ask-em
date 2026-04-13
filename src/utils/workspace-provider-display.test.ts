import { describe, expect, it } from 'vitest';
import { getWorkspaceProviderDisplay } from './workspace-provider-display';

describe('workspace provider display', () => {
  it('prefers paused over prior issues', () => {
    expect(
      getWorkspaceProviderDisplay({
        memberState: 'inactive',
        memberIssue: 'needs-login',
        enabled: false,
        globalSyncEnabled: true,
        hasMember: false,
      }),
    ).toEqual({
      kind: 'paused',
      label: 'Paused',
      detail: 'Sync is paused for this model.',
    });
  });

  it('surfaces persisted login issues even when the tab is inactive', () => {
    expect(
      getWorkspaceProviderDisplay({
        memberState: 'inactive',
        memberIssue: 'needs-login',
        enabled: true,
        globalSyncEnabled: true,
        hasMember: false,
      }),
    ).toEqual({
      kind: 'needs-login',
      label: 'Needs Login',
      detail: 'Sign in before the next sync',
    });
  });

  it('treats recoverable missing tabs as will reopen', () => {
    expect(
      getWorkspaceProviderDisplay({
        memberState: 'inactive',
        memberIssue: null,
        enabled: true,
        globalSyncEnabled: true,
        hasMember: false,
      }),
    ).toEqual({
      kind: 'will-reopen',
      label: 'Will Reopen',
      detail: 'Will reopen on the next sync',
    });
  });

  it('surfaces generic delivery failures as needs attention', () => {
    expect(
      getWorkspaceProviderDisplay({
        memberState: 'inactive',
        memberIssue: 'delivery-failed',
        enabled: true,
        globalSyncEnabled: true,
        hasMember: false,
      }),
    ).toEqual({
      kind: 'needs-attention',
      label: 'Needs Attention',
      detail: 'Last sync did not reach this model. Session may be deleted.',
    });
  });

  it('surfaces provider error pages as needs attention', () => {
    expect(
      getWorkspaceProviderDisplay({
        memberState: 'error',
        memberIssue: 'error-page',
        enabled: true,
        globalSyncEnabled: true,
        hasMember: true,
      }),
    ).toEqual({
      kind: 'needs-attention',
      label: 'Needs Attention',
      detail: 'This page is showing an error. Session may be deleted.',
    });
  });
});
