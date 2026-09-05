// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDomProviderAdapter } from '../adapters/factory';
import { chatgptAdapter } from '../adapters/chatgpt';
import type { UserSubmissionPayload } from '../adapters/types';
import type { UserSubmitMessage } from '../runtime/protocol';
import type { ContentStateController } from './state';
import { createSubmitController } from './submit-controller';

const FORMATTED_PROMPT = '\n    def example():\n\treturn "a  b"\n\n```text\n  keep indentation  \n```\n\n';

function createState() {
  return {
    isSubmissionSuppressed: vi.fn(() => false),
    hasHydratedPresence: vi.fn(() => true),
    shouldSuppressProgrammaticSubmit: vi.fn(() => false),
    shouldSkipDuplicateSubmit: vi.fn(() => false),
    rememberSubmitFingerprint: vi.fn(),
    applyIndicatorPresentation: vi.fn(),
    getUiContext: vi.fn(() => ({
      workspaceId: 'w1', providerEnabled: true, globalSyncEnabled: true,
      standaloneCreateSetEnabled: true,
    })),
    setSyncing: vi.fn(),
    applySubmitResponse: vi.fn(),
    showCurrentWarning: vi.fn(),
    showToast: vi.fn(),
  };
}

describe('prompt formatting during sync', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 160, height: 36, top: 0, left: 0, right: 160, bottom: 36,
      x: 0, y: 0, toJSON() {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it.each([
    ['contenteditable', 'click'],
    ['contenteditable', 'Enter'],
    ['textarea', 'click'],
    ['textarea', 'Enter'],
  ])('preserves whitespace from %s via %s through capture, routing and target injection', async (kind, trigger) => {
    document.body.innerHTML = `
      ${kind === 'textarea' ? '<textarea id="source"></textarea>' : '<div id="source" contenteditable="true"></div>'}
      <button id="send" type="button">Send</button>
      <textarea id="target"></textarea>
    `;
    const composer = document.getElementById('source')!;
    if (composer instanceof HTMLTextAreaElement) {
      composer.value = FORMATTED_PROMPT;
    } else {
      // jsdom does not implement layout-derived innerText; use the rendered
      // text a browser exposes for a rich text composer.
      Object.defineProperty(composer, 'innerText', { value: FORMATTED_PROMPT });
    }
    const adapter = createDomProviderAdapter({
      provider: 'claude', mountId: 'ask-em-format-source', className: 'source',
      composerSelectors: ['#source'], sendButtonSelectors: ['#send'],
    });
    const sendMessage = vi.fn<(message: UserSubmitMessage) => Promise<{ ok: boolean }>>()
      .mockResolvedValue({ ok: true });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    const state = createState();
    const controller = createSubmitController(adapter, state as unknown as ContentStateController, {
      reportPresence: vi.fn(), logDebug: vi.fn(),
    });
    let submitted: Promise<void> | undefined;
    const unsubscribe = adapter.composer!.subscribeToUserSubmissions!((payload) => {
      submitted = controller.reportUserSubmit(payload);
    });
    try {
      if (trigger === 'Enter') {
        composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      } else {
        document.getElementById('send')!.click();
      }
      await submitted;
      expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: 'USER_SUBMIT', content: FORMATTED_PROMPT,
      }));
      expect(state.rememberSubmitFingerprint).toHaveBeenCalledWith(
        `${window.location.href}::${FORMATTED_PROMPT.trim()}`,
      );
      const target = createDomProviderAdapter({
        provider: 'grok', mountId: 'ask-em-format-target', className: 'target',
        composerSelectors: ['#target'],
      });
      await target.composer!.setComposerPayload!({ text: sendMessage.mock.calls[0][0].content, attachments: [] });
      expect((document.getElementById('target') as HTMLTextAreaElement).value).toBe(FORMATTED_PROMPT);
    } finally {
      unsubscribe();
    }
  });

  it('continues to ignore whitespace-only submissions', async () => {
    const adapter = createDomProviderAdapter({
      provider: 'claude', mountId: 'ask-em-format-source', className: 'source', composerSelectors: [],
    });
    const sendMessage = vi.fn();
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    const controller = createSubmitController(adapter, createState() as unknown as ContentStateController, {
      reportPresence: vi.fn(), logDebug: vi.fn(),
    });
    await controller.reportUserSubmit({ text: ' \n\t  ', attachments: [] });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it.each(['role', 'heading'])('preserves formatting when ChatGPT recovers submitted text from a %s message', async (kind) => {
    document.body.innerHTML = `
      <main></main>
      <form data-type="unified-composer">
        <div id="prompt-textarea" contenteditable="true"></div>
        <button type="button" aria-label="Submit dictation"></button>
      </form>
    `;
    const onSubmit = vi.fn<(payload: UserSubmissionPayload) => void>();
    const unsubscribe = chatgptAdapter.composer!.subscribeToUserSubmissions!(onSubmit);
    try {
      document.querySelector<HTMLButtonElement>('button')!.click();
      const message = document.createElement(kind === 'role' ? 'div' : 'h5');
      if (kind === 'role') message.setAttribute('data-message-author-role', 'user');
      Object.defineProperty(message, 'innerText', {
        value: kind === 'role' ? FORMATTED_PROMPT : `You said:\n${FORMATTED_PROMPT}`,
      });
      document.querySelector('main')!.append(message);
      await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ text: FORMATTED_PROMPT }),
      ));
    } finally {
      unsubscribe();
    }
  });
});
