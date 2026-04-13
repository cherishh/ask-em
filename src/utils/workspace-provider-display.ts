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

export type WorkspaceProviderTone =
  | 'active'
  | 'inactive'
  | 'pending'
  | 'sync-paused'
  | 'frozen'
  | 'warning';

export type WorkspaceProviderDotState =
  | 'active'
  | 'pending'
  | 'frozen'
  | 'warning'
  | 'inactive';

export type WorkspaceProviderDisplayInput = {
  memberState: GroupMemberState;
  memberIssue: WorkspaceIssue | null;
  enabled: boolean;
  globalSyncEnabled: boolean;
  hasMember: boolean;
};

export type WorkspaceProviderPresentation = WorkspaceProviderDisplay & {
  tone: WorkspaceProviderTone;
  dotState: WorkspaceProviderDotState;
};

export function getWorkspaceProviderDisplay(
  input: WorkspaceProviderDisplayInput,
): WorkspaceProviderDisplay {
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

export function getWorkspaceProviderTone(
  display: WorkspaceProviderDisplay,
  globalSyncEnabled: boolean,
): WorkspaceProviderTone {
  switch (display.kind) {
    case 'ready':
      return 'active';
    case 'connecting':
      return 'pending';
    case 'paused':
      return globalSyncEnabled ? 'sync-paused' : 'frozen';
    case 'needs-login':
    case 'loading':
    case 'needs-attention':
      return 'warning';
    case 'will-reopen':
      return 'inactive';
  }
}

export function getWorkspaceProviderDotState(
  input: WorkspaceProviderDisplayInput,
): WorkspaceProviderDotState {
  if ((!input.globalSyncEnabled || !input.enabled) && input.memberState === 'ready') {
    return 'frozen';
  }

  if (
    input.memberIssue === 'needs-login' ||
    input.memberIssue === 'loading' ||
    input.memberIssue === 'delivery-failed' ||
    input.memberIssue === 'error-page'
  ) {
    return 'warning';
  }

  if (input.memberState === 'ready') {
    return 'active';
  }

  if (input.memberState === 'pending') {
    return 'pending';
  }

  if (
    input.memberState === 'login-required' ||
    input.memberState === 'not-ready' ||
    input.memberState === 'error'
  ) {
    return 'warning';
  }

  return 'inactive';
}

export function getWorkspaceProviderPresentation(
  input: WorkspaceProviderDisplayInput,
): WorkspaceProviderPresentation {
  const display = getWorkspaceProviderDisplay(input);

  return {
    ...display,
    tone: getWorkspaceProviderTone(display, input.globalSyncEnabled),
    dotState: getWorkspaceProviderDotState(input),
  };
}
