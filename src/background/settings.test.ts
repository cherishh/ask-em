import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultEnabledProviders, type LocalState } from '../runtime/protocol';
import { makeLocalState } from '../test/builders';

const storageMocks = vi.hoisted(() => ({
  appendDebugLog: vi.fn().mockResolvedValue(undefined),
  clearDebugLogs: vi.fn(),
  getLocalState: vi.fn(),
  getSessionState: vi.fn(),
  setLocalState: vi.fn(),
  setSessionState: vi.fn(),
}));

vi.mock('../runtime/storage', () => storageMocks);

describe('settings handlers', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    storageMocks.setLocalState.mockImplementation(async (state: LocalState) => state);
  });

  it('adds newly enabled providers to the default fan-out selection', async () => {
    storageMocks.getLocalState.mockResolvedValue(makeLocalState({
      defaultEnabledProviders: createDefaultEnabledProviders(['claude', 'chatgpt']),
      defaultFanOutProviders: ['claude'],
    }));

    const { handleSetDefaultEnabledProviders } = await import('./settings');
    const result = await handleSetDefaultEnabledProviders({
      type: 'SET_DEFAULT_ENABLED_PROVIDERS',
      providers: ['claude', 'chatgpt', 'gemini'],
    });

    expect(result).toEqual({ ok: true });
    expect(storageMocks.setLocalState).toHaveBeenCalledWith(expect.objectContaining({
      defaultEnabledProviders: createDefaultEnabledProviders(['claude', 'chatgpt', 'gemini']),
      defaultFanOutProviders: ['claude', 'gemini'],
    }));
  });

  it('stores default fan-out providers outside the legacy enabled-provider fallback', async () => {
    storageMocks.getLocalState.mockResolvedValue(makeLocalState({
      defaultEnabledProviders: createDefaultEnabledProviders(['claude', 'chatgpt']),
      defaultFanOutProviders: null,
    }));

    const { handleSetDefaultFanOutProviders } = await import('./settings');
    const result = await handleSetDefaultFanOutProviders({
      type: 'SET_DEFAULT_FAN_OUT_PROVIDERS',
      providers: ['claude', 'deepseek'],
    });

    expect(result).toEqual({ ok: true });
    expect(storageMocks.setLocalState).toHaveBeenCalledWith(expect.objectContaining({
      defaultFanOutProviders: ['claude', 'deepseek'],
    }));
  });

  it('stores a normalized popup-only provider order', async () => {
    storageMocks.getLocalState.mockResolvedValue(makeLocalState());

    const { handleSetPopupProviderOrder } = await import('./settings');
    const result = await handleSetPopupProviderOrder({
      type: 'SET_POPUP_PROVIDER_ORDER',
      providers: ['kimi', 'claude', 'kimi'],
    });

    expect(result).toEqual({ ok: true });
    expect(storageMocks.setLocalState).toHaveBeenCalledWith(expect.objectContaining({
      popupProviderOrder: ['kimi', 'claude', 'chatgpt', 'gemini', 'grok', 'deepseek', 'manus'],
    }));
  });
});
