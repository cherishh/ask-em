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

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void refresh({ silent: true });
    }, 1200);

    return () => window.clearInterval(intervalId);
  }, [refresh]);

  const clearWorkspace = useCallback(async (workspaceId: string) => {
    setBusyKey(workspaceId);
    try {
      await chrome.runtime.sendMessage({ type: 'CLEAR_WORKSPACE', workspaceId });
      await refresh();
    } finally {
      setBusyKey(null);
    }
  }, [refresh]);

  const clearProvider = useCallback(async (workspaceId: string, provider: Provider) => {
    setBusyKey(`${workspaceId}:${provider}`);
    try {
      await chrome.runtime.sendMessage({ type: 'CLEAR_WORKSPACE_PROVIDER', workspaceId, provider });
      await refresh();
    } finally {
      setBusyKey(null);
    }
  }, [refresh]);

  const toggleDefaultProvider = useCallback(async (provider: Provider) => {
    const nextProviders = selectedProviders.includes(provider)
      ? selectedProviders.filter((item) => item !== provider)
      : [...selectedProviders, provider];

    setSelectedProviders(nextProviders);
    await chrome.runtime.sendMessage({
      type: 'SET_DEFAULT_ENABLED_PROVIDERS',
      providers: nextProviders,
    });
    await refresh();
  }, [refresh, selectedProviders]);

  const toggleGlobalSync = useCallback(async () => {
    const nextEnabled = !status?.globalSyncEnabled;
    await chrome.runtime.sendMessage({
      type: 'SET_GLOBAL_SYNC_ENABLED',
      enabled: nextEnabled,
    });
    await refresh({ silent: true });
  }, [refresh, status?.globalSyncEnabled]);

  const toggleAutoSyncNewChats = useCallback(async () => {
    const nextEnabled = !status?.autoSyncNewChatsEnabled;
    await chrome.runtime.sendMessage({
      type: 'SET_AUTO_SYNC_NEW_CHATS_ENABLED',
      enabled: nextEnabled,
    });
    await refresh({ silent: true });
  }, [refresh, status?.autoSyncNewChatsEnabled]);

  const toggleCloseTabsOnDeleteSet = useCallback(async () => {
    const nextEnabled = !status?.closeTabsOnDeleteSet;
    await chrome.runtime.sendMessage({
      type: 'SET_CLOSE_TABS_ON_DELETE_SET',
      enabled: nextEnabled,
    });
    await refresh({ silent: true });
  }, [refresh, status?.closeTabsOnDeleteSet]);

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
    await chrome.runtime.sendMessage({ type: 'RESET_INDICATOR_POSITIONS' });
    await refresh({ silent: true });
  }, [refresh]);

  const clearPersistentStorage = useCallback(async () => {
    await chrome.runtime.sendMessage({ type: 'CLEAR_PERSISTENT_STORAGE' });
    await refresh();
  }, [refresh]);

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
