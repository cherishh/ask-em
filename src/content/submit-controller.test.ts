// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSubmitController } from './submit-controller';
import type { ProviderAdapter } from '../adapters/types';
import { ATTACHMENT_MAX_FILE_BYTES } from '../runtime/protocol';

function createAdapter(): ProviderAdapter {
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
    },
  };
}

function createState() {
  return {
    isSubmissionSuppressed: vi.fn(() => false),
    hasHydratedPresence: vi.fn(() => true),
    shouldSuppressProgrammaticSubmit: vi.fn(() => false),
    shouldSkipDuplicateSubmit: vi.fn(() => false),
    rememberSubmitFingerprint: vi.fn(),
    applyIndicatorPresentation: vi.fn(),
    getUiContext: vi.fn(() => ({
      workspaceId: 'w1',
      standaloneCreateSetEnabled: true,
    })),
    setSyncing: vi.fn(),
    applySubmitResponse: vi.fn(),
    showCurrentWarning: vi.fn(),
    showToast: vi.fn(),
  };
}

describe('submit controller attachment staging', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => 'submit-1'),
    });
  });

  it('writes attachments after dedupe and sends USER_SUBMIT only after finalize', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'ATTACHMENT_FINALIZE') {
        return {
          ok: true,
          ref: {
            id: 'a1',
            name: 'sample.pdf',
            mime: 'application/pdf',
            size: 3,
          },
        };
      }

      return { ok: true };
    });
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage,
      },
    });

    const state = createState();
    const onConsumed = vi.fn();
    const file = new File(['abc'], 'sample.pdf', { type: 'application/pdf' });
    const arrayBufferSpy = vi.spyOn(file, 'arrayBuffer');
    const controller = createSubmitController(createAdapter(), state as any, {
      reportPresence: vi.fn(),
      logDebug: vi.fn(),
    });

    await controller.reportUserSubmit({
      text: 'hello',
      attachments: [
        {
          id: 'a1',
          name: 'sample.pdf',
          mime: 'application/pdf',
          size: 3,
          source: 'file-input',
          file,
        },
      ],
      onConsumed,
    });

    expect(state.rememberSubmitFingerprint).toHaveBeenCalledWith(
      'https://claude.ai/chat/c-1::hello::a1',
    );
    expect(sendMessage.mock.calls.map(([message]) => message.type)).toEqual([
      'ATTACHMENT_CREATE',
      'ATTACHMENT_APPEND_CHUNK',
      'ATTACHMENT_FINALIZE',
      'USER_SUBMIT',
    ]);
    expect(sendMessage.mock.calls[0]?.[0]).toMatchObject({
      type: 'ATTACHMENT_CREATE',
      name: 'sample.pdf',
      mime: 'application/pdf',
      size: 3,
    });
    expect(arrayBufferSpy).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'USER_SUBMIT',
      submitId: 'submit-1',
      attachments: [
        {
          id: 'a1',
          name: 'sample.pdf',
          mime: 'application/pdf',
          size: 3,
        },
      ],
    });
    expect(onConsumed).toHaveBeenCalled();
  });

  it('shows a provider-limit toast when a target skips an over-count attachment batch', async () => {
    const sendMessage = vi.fn(async (message: { type: string; attachmentId?: string }) => {
      if (message.type === 'ATTACHMENT_FINALIZE') {
        return {
          ok: true,
          ref: {
            id: message.attachmentId ?? 'a1',
            name: `${message.attachmentId ?? 'a1'}.txt`,
            mime: 'text/plain',
            size: 3,
          },
        };
      }

      if (message.type === 'USER_SUBMIT') {
        return {
          ok: true,
          synced: true,
          workspaceId: 'w1',
          providerEnabled: true,
          globalSyncEnabled: true,
          canStartNewSet: true,
          deliveryResults: [
            { provider: 'manus', ok: false, reason: 'manus attachment count not supported' },
            { provider: 'chatgpt', ok: true },
          ],
        };
      }

      return { ok: true };
    });
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage,
      },
    });

    const state = createState();
    const controller = createSubmitController(createAdapter(), state as any, {
      reportPresence: vi.fn(),
      logDebug: vi.fn(),
    });

    await controller.reportUserSubmit({
      text: 'hello',
      attachments: [
        {
          id: 'a1',
          name: 'one.txt',
          mime: 'text/plain',
          size: 3,
          source: 'file-input',
          file: new File(['one'], 'one.txt', { type: 'text/plain' }),
        },
        {
          id: 'a2',
          name: 'two.txt',
          mime: 'text/plain',
          size: 3,
          source: 'file-input',
          file: new File(['two'], 'two.txt', { type: 'text/plain' }),
        },
      ],
    });

    expect(state.showToast).toHaveBeenCalledWith(
      'Manus skipped: this prompt has 2 files; Manus supports 1 file. Other providers synced.',
      'warning',
    );
  });

  it('does not write attachments when duplicate submit is skipped', async () => {
    const sendMessage = vi.fn();
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage,
      },
    });

    const state = createState();
    state.shouldSkipDuplicateSubmit.mockReturnValue(true);
    const controller = createSubmitController(createAdapter(), state as any, {
      reportPresence: vi.fn(),
      logDebug: vi.fn(),
    });

    await controller.reportUserSubmit({
      text: 'hello',
      attachments: [
        {
          id: 'a1',
          name: 'sample.pdf',
          mime: 'application/pdf',
          size: 3,
          source: 'file-input',
          file: new File(['abc'], 'sample.pdf', { type: 'application/pdf' }),
        },
      ],
    });

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('sends text-only submit when attachment staging fails before any store entry is created', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'ATTACHMENT_CREATE') {
        return { ok: false, error: 'attachment budget exceeded' };
      }

      return { ok: true };
    });
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage,
      },
    });

    const state = createState();
    const controller = createSubmitController(createAdapter(), state as any, {
      reportPresence: vi.fn(),
      logDebug: vi.fn(),
    });

    await controller.reportUserSubmit({
      text: 'hello',
      attachments: [
        {
          id: 'a1',
          name: 'sample.pdf',
          mime: 'application/pdf',
          size: 3,
          source: 'file-input',
          file: new File(['abc'], 'sample.pdf', { type: 'application/pdf' }),
        },
      ],
    });

    expect(sendMessage.mock.calls.map(([message]) => message.type)).toEqual([
      'ATTACHMENT_CREATE',
      'USER_SUBMIT',
    ]);
    expect(sendMessage.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'USER_SUBMIT',
      attachments: [],
    });
    expect(state.showCurrentWarning).toHaveBeenCalledWith('attachment sync skipped');
  });

  it('shows a toast when ambiguous source attachments are skipped before staging', async () => {
    const sendMessage = vi.fn(async (_message: unknown) => ({ ok: true }));
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage,
      },
    });

    const state = createState();
    const controller = createSubmitController(createAdapter(), state as any, {
      reportPresence: vi.fn(),
      logDebug: vi.fn(),
    });

    await controller.reportUserSubmit({
      text: 'hello',
      attachments: [],
      attachmentResolution: {
        attachments: [],
        capturedCount: 2,
        currentCount: 1,
        submittedCount: 0,
        reason: 'ambiguous-current-attachments',
      },
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[0]).toMatchObject({
      type: 'USER_SUBMIT',
      attachments: [],
    });
    expect(state.showCurrentWarning).toHaveBeenCalledWith('attachment sync skipped');
    expect(state.showToast).toHaveBeenCalledWith(
      'Attachment sync skipped: current files could not be confirmed.',
      'warning',
    );
  });

  it('rejects oversized attachments before reading file bytes', async () => {
    const sendMessage = vi.fn(async (_message: unknown) => ({ ok: true }));
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage,
      },
    });

    const file = new File(['abc'], 'huge.bin', { type: 'application/octet-stream' });
    const arrayBufferSpy = vi.spyOn(file, 'arrayBuffer');
    const state = createState();
    const controller = createSubmitController(createAdapter(), state as any, {
      reportPresence: vi.fn(),
      logDebug: vi.fn(),
    });

    await controller.reportUserSubmit({
      text: 'hello',
      attachments: [
        {
          id: 'a1',
          name: 'huge.bin',
          mime: 'application/octet-stream',
          size: ATTACHMENT_MAX_FILE_BYTES + 1,
          source: 'file-input',
          file,
        },
      ],
    });

    expect(arrayBufferSpy).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[0]).toMatchObject({
      type: 'USER_SUBMIT',
      attachments: [],
    });
    expect(state.showCurrentWarning).toHaveBeenCalledWith('attachment too large');
  });
});
