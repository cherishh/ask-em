import type { PageState, PingResponseMessage, Provider } from '../runtime/protocol';

export function isTerminalRecoveryPageState(pageState: PageState): boolean {
  return (
    pageState === 'ready' ||
    pageState === 'login-required' ||
    pageState === 'error' ||
    pageState === 'private-mode' ||
    pageState === 'read-only'
  );
}

export function getRecoveryStatusError(
  provider: Provider,
  status: PingResponseMessage | null,
): string | null {
  if (!status) {
    return `${provider} not ready`;
  }

  if (status.pageState === 'login-required') {
    return `${provider} login required`;
  }

  if (status.pageState === 'error') {
    return `${provider} error page`;
  }

  if (status.pageState === 'private-mode') {
    return `${provider} private chat`;
  }

  if (status.pageState === 'read-only') {
    return `${provider} read-only page`;
  }

  if (status.pageState !== 'ready') {
    return `${provider} not ready`;
  }

  return null;
}
