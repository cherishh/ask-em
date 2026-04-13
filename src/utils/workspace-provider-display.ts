import type { GroupMemberState, WorkspaceIssue } from '../runtime/protocol';

export type WorkspaceProviderDisplayKind =
  | 'ready'
  | 'connecting'
  | 'paused'
  | 'needs-login'
  | 'loading'
  | 'needs-attention'
  | 'will-reopen';

export type WorkspaceProviderDisplay = {
  kind: WorkspaceProviderDisplayKind;
  label: string;
  detail: string;
};

export function getWorkspaceProviderDisplay(input: {
  memberState: GroupMemberState;
  memberIssue: WorkspaceIssue | null;
  enabled: boolean;
  globalSyncEnabled: boolean;
  hasMember: boolean;
}): WorkspaceProviderDisplay {
  if (input.memberState === 'pending') {
    return {
      kind: 'connecting',
      label: 'Connecting',
      detail: 'Waiting for this model to connect',
    };
  }

  if (!input.globalSyncEnabled || !input.enabled) {
    return {
      kind: 'paused',
      label: 'Paused',
      detail: !input.globalSyncEnabled ? 'Global sync is paused.' : 'Sync is paused for this model.',
    };
  }

  if (input.memberIssue === 'needs-login' || input.memberState === 'login-required') {
    return {
      kind: 'needs-login',
      label: 'Needs Login',
      detail: 'Sign in before the next sync',
    };
  }

  if (input.memberIssue === 'error-page' || input.memberState === 'error') {
    return {
      kind: 'needs-attention',
      label: 'Needs Attention',
      detail: 'This page is showing an error. Session may be deleted.',
    };
  }

  if (input.memberIssue === 'loading' || input.memberState === 'not-ready') {
    return {
      kind: 'loading',
      label: 'Loading',
      detail: 'Wait for this page to become ready',
    };
  }

  if (input.memberIssue === 'delivery-failed') {
    return {
      kind: 'needs-attention',
      label: 'Needs Attention',
      detail: 'Last sync did not reach this model. Session may be deleted.',
    };
  }

  if (!input.hasMember || input.memberState === 'inactive') {
    return {
      kind: 'will-reopen',
      label: 'Will Reopen',
      detail: 'Will reopen on the next sync',
    };
  }

  return {
    kind: 'ready',
    label: 'Ready',
    detail: 'Next prompt will be synced',
  };
}
