import { startTransition, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ALL_PROVIDERS as PROVIDERS,
  DEFAULT_SHORTCUTS,
  resolveShortcutConfig,
} from '../../../runtime/protocol';
import type {
  Provider,
  ShortcutBinding,
  ShortcutConfig,
  ShortcutId,
  StatusResponseMessage,
} from '../../../runtime/protocol';
import { requestStatus } from '../popup-runtime';

const POPUP_STATUS_POLL_MS = 3_000;

export function usePopupStatus() {
  const [status, setStatus] = useState<StatusResponseMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedProviders, setSelectedProviders] = useState<Provider[]>(PROVIDERS);
  const [shortcuts, setShortcuts] = useState<ShortcutConfig>(DEFAULT_SHORTCUTS);
  const resolvedShortcuts = useMemo(() => resolveShortcutConfig(shortcuts), [shortcuts]);

  const refresh = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) {
      setLoading(true);
    }

    try {
      const nextStatus = await requestStatus();
      startTransition(() => {
        if (nextStatus) {
          setStatus(nextStatus);
          setSelectedProviders(
            PROVIDERS.filter((provider) => nextStatus.defaultEnabledProviders[provider]),
          );
          setShortcuts(resolveShortcutConfig(nextStatus.shortcuts));
        }
      });
    } finally {
      if (!options.silent) {
        startTransition(() => {
          setLoading(false);
        });
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refreshIfVisible = useCallback(async () => {
    if (document.visibilityState === 'hidden') {
      return;
    }

    await refresh({ silent: true });
  }, [refresh]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refresh({ silent: true });
      }
    };

    const intervalId = window.setInterval(() => {
      void refreshIfVisible();
    }, POPUP_STATUS_POLL_MS);

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refresh, refreshIfVisible]);

  const sendRuntimeMessage = useCallback(
    async (message: Record<string, unknown>, options: { silentRefresh?: boolean } = {}) => {
      await chrome.runtime.sendMessage(message);
      await refresh(options.silentRefresh ? { silent: true } : undefined);
    },
    [refresh],
  );

  const runBusyAction = useCallback(
    async (key: string, action: () => Promise<void>) => {
      setBusyKey(key);
      try {
        await action();
      } finally {
        setBusyKey(null);
      }
    },
    [],
  );

  const clearWorkspace = useCallback(async (workspaceId: string) => {
    await runBusyAction(workspaceId, async () => {
      await sendRuntimeMessage({ type: 'CLEAR_WORKSPACE', workspaceId });
    });
  }, [runBusyAction, sendRuntimeMessage]);

  const clearProvider = useCallback(async (workspaceId: string, provider: Provider) => {
    await runBusyAction(`${workspaceId}:${provider}`, async () => {
      await sendRuntimeMessage({ type: 'CLEAR_WORKSPACE_PROVIDER', workspaceId, provider });
    });
  }, [runBusyAction, sendRuntimeMessage]);

  const toggleDefaultProvider = useCallback(async (provider: Provider) => {
    const nextProviders = selectedProviders.includes(provider)
      ? selectedProviders.filter((item) => item !== provider)
      : [...selectedProviders, provider];

    setSelectedProviders(nextProviders);
    await sendRuntimeMessage({
      type: 'SET_DEFAULT_ENABLED_PROVIDERS',
      providers: nextProviders,
    });
  }, [selectedProviders, sendRuntimeMessage]);

  const toggleGlobalSync = useCallback(async () => {
    const nextEnabled = !status?.globalSyncEnabled;
    await sendRuntimeMessage({
      type: 'SET_GLOBAL_SYNC_ENABLED',
      enabled: nextEnabled,
    }, { silentRefresh: true });
  }, [sendRuntimeMessage, status?.globalSyncEnabled]);

  const toggleAutoSyncNewChats = useCallback(async () => {
    const nextEnabled = !status?.autoSyncNewChatsEnabled;
    await sendRuntimeMessage({
      type: 'SET_AUTO_SYNC_NEW_CHATS_ENABLED',
      enabled: nextEnabled,
    }, { silentRefresh: true });
  }, [sendRuntimeMessage, status?.autoSyncNewChatsEnabled]);

  const toggleCloseTabsOnDeleteSet = useCallback(async () => {
    const nextEnabled = !status?.closeTabsOnDeleteSet;
    await sendRuntimeMessage({
      type: 'SET_CLOSE_TABS_ON_DELETE_SET',
      enabled: nextEnabled,
    }, { silentRefresh: true });
  }, [sendRuntimeMessage, status?.closeTabsOnDeleteSet]);

  const updateShortcut = useCallback(async (id: ShortcutId, binding: ShortcutBinding) => {
    const next = { ...resolvedShortcuts, [id]: binding };
    setShortcuts(next);
    await chrome.runtime.sendMessage({ type: 'SET_SHORTCUTS', shortcuts: next });
  }, [resolvedShortcuts]);

  const resetShortcuts = useCallback(async () => {
    setShortcuts(DEFAULT_SHORTCUTS);
    await chrome.runtime.sendMessage({ type: 'SET_SHORTCUTS', shortcuts: DEFAULT_SHORTCUTS });
  }, []);

  const resetIndicatorPositions = useCallback(async () => {
    await sendRuntimeMessage({ type: 'RESET_INDICATOR_POSITIONS' }, { silentRefresh: true });
  }, [sendRuntimeMessage]);

  const clearPersistentStorage = useCallback(async () => {
    await sendRuntimeMessage({ type: 'CLEAR_PERSISTENT_STORAGE' });
  }, [sendRuntimeMessage]);

  return {
    status,
    loading,
    busyKey,
    selectedProviders,
    shortcuts,
    resolvedShortcuts,
    refresh,
    clearWorkspace,
    clearProvider,
    toggleDefaultProvider,
    toggleAutoSyncNewChats,
    toggleGlobalSync,
    toggleCloseTabsOnDeleteSet,
    updateShortcut,
    resetShortcuts,
    resetIndicatorPositions,
    clearPersistentStorage,
  };
}
