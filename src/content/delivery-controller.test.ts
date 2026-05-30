import { describe, expect, it, vi } from 'vitest';
import { createDeliveryController } from './delivery-controller';
import type { ProviderAdapter } from '../adapters/types';

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForAssertion(assertion: () => void) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  throw lastError;
}

function createState() {
  return {
    showCurrentWarning: vi.fn(),
    handleSyncProgress: vi.fn(),
  };
}

function createAdapter(overrides: Partial<NonNullable<ProviderAdapter['composer']>> = {}): ProviderAdapter {
  return {
    name: 'claude',
    getUiSpec() {
      return {
        mountId: 'ask-em-test-ui',
        className: 'ask-em-test-ui',
      };
    },
    session: {
      getCurrentUrl: () => 'https://claude.ai/chat/c-1',
      getStatus: () => ({
        provider: 'claude',
        currentUrl: 'https://claude.ai/chat/c-1',
        sessionId: 'c-1',
        pageKind: 'existing-session',
        pageState: 'ready',
      }),
      canDeliverPrompt: () => true,
    },
    composer: {
      setComposerText: vi.fn(),
      setComposerPayload: vi.fn(),
      getComposerAttachmentPresence: vi.fn()
        .mockResolvedValue({ count: 1 })
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 }),
      detectAttachmentUploadError: vi.fn(() => null),
      submit: vi.fn(),
      ...overrides,
    },
  };
}

describe('content delivery controller attachment flow', () => {
  it('confirms attachment presence before submit', async () => {
    const adapter = createAdapter();
    const sendResponse = vi.fn();
    const controller = createDeliveryController(adapter, createState() as any, {
      suppressObservedSubmissionsFor: vi.fn(),
      rememberProgrammaticSubmit: vi.fn(),
    }, {
      reportPresence: vi.fn(),
      resetIndicatorPosition: vi.fn(),
      logDebug: vi.fn(),
    });

    controller.handleRuntimeMessage({
      type: 'DELIVER_PROMPT',
      workspaceId: 'w1',
      provider: 'claude',
      content: 'hello',
      attachments: [{ id: 'a1', name: 'a.png', mime: 'image/png', size: 1 }],
      expectedSessionId: 'c-1',
      expectedUrl: 'https://claude.ai/chat/c-1',
      timestamp: 1,
    }, sendResponse);
    await flushMicrotasks();

    expect(adapter.composer?.setComposerPayload).toHaveBeenCalled();
    await waitForAssertion(() => {
      expect(adapter.composer?.submit).toHaveBeenCalledWith({ timeoutMs: 30_000 });
      expect(sendResponse).toHaveBeenCalledWith({ ok: true, accepted: true, confirmed: true });
    });
  });

  it('uses count delta as a fallback when attachment keys are not unique', async () => {
    const adapter = createAdapter({
      getComposerAttachmentPresence: vi.fn()
        .mockResolvedValueOnce({ count: 0, keys: [] })
        .mockResolvedValueOnce({ count: 2, keys: ['README.md'] }),
    });
    const sendResponse = vi.fn();
    const controller = createDeliveryController(adapter, createState() as any, {
      suppressObservedSubmissionsFor: vi.fn(),
      rememberProgrammaticSubmit: vi.fn(),
    }, {
      reportPresence: vi.fn(),
      resetIndicatorPosition: vi.fn(),
      logDebug: vi.fn(),
    });

    controller.handleRuntimeMessage({
      type: 'DELIVER_PROMPT',
      workspaceId: 'w1',
      provider: 'claude',
      content: 'hello',
      attachments: [
        { id: 'a1', name: 'README.md', mime: 'text/markdown', size: 1 },
        { id: 'a2', name: 'README.md', mime: 'text/markdown', size: 1 },
      ],
      expectedSessionId: 'c-1',
      expectedUrl: 'https://claude.ai/chat/c-1',
      timestamp: 1,
    }, sendResponse);
    await flushMicrotasks();

    await waitForAssertion(() => {
      expect(adapter.composer?.submit).toHaveBeenCalledWith({ timeoutMs: 30_000 });
      expect(sendResponse).toHaveBeenCalledWith({ ok: true, accepted: true, confirmed: true });
    });
  });

  it('does not submit when upload error is detected', async () => {
    const adapter = createAdapter({
      getComposerAttachmentPresence: vi.fn().mockResolvedValue({ count: 0 }),
      detectAttachmentUploadError: vi.fn(() => 'upload failed'),
    });
    const sendResponse = vi.fn();
    const state = createState();
    const controller = createDeliveryController(adapter, state as any, {
      suppressObservedSubmissionsFor: vi.fn(),
      rememberProgrammaticSubmit: vi.fn(),
    }, {
      reportPresence: vi.fn(),
      resetIndicatorPosition: vi.fn(),
      logDebug: vi.fn(),
    });

    controller.handleRuntimeMessage({
      type: 'DELIVER_PROMPT',
      workspaceId: 'w1',
      provider: 'claude',
      content: 'hello',
      attachments: [{ id: 'a1', name: 'a.png', mime: 'image/png', size: 1 }],
      expectedSessionId: 'c-1',
      expectedUrl: 'https://claude.ai/chat/c-1',
      timestamp: 1,
    }, sendResponse);
    await flushMicrotasks();

    await waitForAssertion(() => {
      expect(adapter.composer?.submit).not.toHaveBeenCalled();
      expect(state.showCurrentWarning).toHaveBeenCalledWith('Delivery failed');
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        error: 'upload failed',
      });
    });
  });
});
