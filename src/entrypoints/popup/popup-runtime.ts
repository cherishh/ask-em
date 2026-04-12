import type { DebugLogEntry, StatusResponseMessage } from '../../runtime/protocol';

export async function requestStatus(): Promise<StatusResponseMessage | null> {
  try {
    return await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
  } catch (error) {
    console.warn('ask-em: failed to load popup status', error);
    return null;
  }
}

export async function requestFullLogs(): Promise<DebugLogEntry[]> {
  const response = (await chrome.runtime.sendMessage({
    type: 'GET_DEBUG_LOGS',
  })) as { logs?: DebugLogEntry[] } | null;

  return response?.logs ?? [];
}

export function downloadJsonFile(filename: string, payload: string) {
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
