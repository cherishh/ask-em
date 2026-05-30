import { describe, expect, it } from 'vitest';
import { DEFAULT_SHORTCUTS } from '../runtime/protocol';
import { buildPresenceContextTransition } from './context';
import type { UiContext } from './ui';

function createContext(overrides: Partial<UiContext> = {}): UiContext {
  return {
    workspaceId: null,
    providerEnabled: true,
    globalSyncEnabled: true,
    standaloneReady: true,
    standaloneCreateSetEnabled: false,
    standaloneFanOutTargetCount: 2,
    canStartNewSet: true,
    shortcuts: DEFAULT_SHORTCUTS,
    ...overrides,
  };
}

describe('content context transitions', () => {
  it('uses the persisted auto-sync setting for standalone new-chat state', () => {
    const transition = buildPresenceContextTransition({
      currentContext: createContext({
        standaloneCreateSetEnabled: false,
      }),
      standaloneVisible: true,
      response: {
        workspaceId: null,
        globalSyncEnabled: true,
        autoSyncNewChatsEnabled: true,
        nextFanOutTargetCount: 2,
        canStartNewSet: true,
        shortcuts: DEFAULT_SHORTCUTS,
      },
    });

    expect(transition.uiContext.standaloneCreateSetEnabled).toBe(true);
    expect(transition.uiContext.standaloneFanOutTargetCount).toBe(2);
  });
});
