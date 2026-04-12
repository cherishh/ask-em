import { useCallback, useState } from 'react';
import { downloadJsonFile, requestFullLogs } from '../popup-runtime';

export function useDiagnostics(
  debugLoggingEnabled: boolean | undefined,
  refresh: (options?: { silent?: boolean }) => Promise<void>,
) {
  const [logActionBusy, setLogActionBusy] = useState(false);

  const clearLogs = useCallback(async () => {
    setLogActionBusy(true);
    try {
      await chrome.runtime.sendMessage({ type: 'CLEAR_DEBUG_LOGS' });
      await refresh();
    } finally {
      setLogActionBusy(false);
    }
  }, [refresh]);

  const toggleDebugLogging = useCallback(async () => {
    const nextEnabled = !debugLoggingEnabled;
    setLogActionBusy(true);
    try {
      await chrome.runtime.sendMessage({ type: 'SET_DEBUG_LOGGING_ENABLED', enabled: nextEnabled });
      await refresh();
    } finally {
      setLogActionBusy(false);
    }
  }, [debugLoggingEnabled, refresh]);

  const downloadLogs = useCallback(async () => {
    setLogActionBusy(true);
    try {
      const logs = await requestFullLogs();
      const payload = JSON.stringify(logs, null, 2);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      downloadJsonFile(`ask-em-debug-logs-${timestamp}.json`, payload);
    } finally {
      setLogActionBusy(false);
    }
  }, []);

  const copyLogs = useCallback(async () => {
    setLogActionBusy(true);
    try {
      const logs = await requestFullLogs();
      const payload = JSON.stringify(logs, null, 2);
      await navigator.clipboard.writeText(payload);
    } finally {
      setLogActionBusy(false);
    }
  }, []);

  return {
    logActionBusy,
    clearLogs,
    toggleDebugLogging,
    downloadLogs,
    copyLogs,
  };
}
