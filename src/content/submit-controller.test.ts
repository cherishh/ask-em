// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSubmitController } from './submit-controller';
import type { ProviderAdapter } from '../adapters/types';

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

  it('aborts partial attachment writes and sends text-only submit on staging failure', async () => {
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
      'ATTACHMENT_ABORT',
      'USER_SUBMIT',
    ]);
    expect(sendMessage.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'USER_SUBMIT',
      attachments: [],
    });
    expect(state.showCurrentWarning).toHaveBeenCalledWith('attachment sync skipped');
  });
});
