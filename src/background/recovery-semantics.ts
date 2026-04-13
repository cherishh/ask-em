import type { PageState, PingResponseMessage, Provider } from '../runtime/protocol';

export function isTerminalRecoveryPageState(pageState: PageState): boolean {
  return pageState === 'ready' || pageState === 'login-required' || pageState === 'error';
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

  if (status.pageState !== 'ready') {
    return `${provider} not ready`;
  }

  return null;
}
