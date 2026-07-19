// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isKimiChatRoute, kimiAdapter } from './kimi';

function mockVisibleLayout() {
  return vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(() => ({
      width: 160,
      height: 36,
      top: 0,
      left: 0,
      right: 160,
      bottom: 36,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    }));
}

function renderKimiComposer() {
  document.body.innerHTML = `
    <div id="chat-box">
      <div class="chat-input-editor" contenteditable="true" role="textbox"><p><br></p></div>
      <div class="send-button-container disabled"><svg name="Send"></svg></div>
    </div>
  `;
}

describe('Kimi adapter', () => {
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/');
    rectSpy = mockVisibleLayout();
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn((command: string, _showUi?: boolean, value?: string) => {
        if (command === 'selectAll') {
          return true;
        }
        const composer = document.querySelector<HTMLElement>('.chat-input-editor');
        if (command === 'insertText' && composer) {
          composer.textContent = value ?? '';
          return true;
        }
        if (command === 'delete' && composer) {
          composer.textContent = '';
          return true;
        }
        return false;
      }),
    });
  });

  afterEach(() => {
    rectSpy.mockRestore();
    Reflect.deleteProperty(document, 'execCommand');
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/');
  });

  it('recognizes Kimi chat routes but excludes chat history', () => {
    expect(isKimiChatRoute('https://www.kimi.com/')).toBe(true);
    expect(isKimiChatRoute('https://www.kimi.com/chat/conversation-id')).toBe(true);
    expect(isKimiChatRoute('https://www.kimi.com/chat/history')).toBe(false);
    expect(isKimiChatRoute('https://www.kimi.com/chat/history/')).toBe(false);
    expect(isKimiChatRoute('https://www.kimi.com/agent-swarm')).toBe(false);
  });

  it('reports a normal new-chat composer as ready', () => {
    renderKimiComposer();

    expect(kimiAdapter.session.getStatus()).toMatchObject({
      provider: 'kimi',
      pageKind: 'new-chat',
      pageState: 'ready',
      sessionId: null,
    });
  });

  it('captures Kimi text submissions', () => {
    renderKimiComposer();
    const composer = document.querySelector<HTMLElement>('.chat-input-editor');
    const sendButton = document.querySelector<HTMLElement>('.send-button-container');
    if (composer) {
      composer.textContent = 'hello Kimi';
    }
    sendButton?.classList.remove('disabled');

    const onSubmit = vi.fn();
    const unsubscribe = kimiAdapter.composer?.subscribeToUserSubmissions?.(onSubmit);
    sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello Kimi',
      attachments: [],
    }));
    unsubscribe?.();
  });

  it('sets Lexical text once', async () => {
    renderKimiComposer();

    await kimiAdapter.composer?.setComposerPayload?.({
      text: 'hello',
      attachments: [],
    });

    expect(document.querySelector('.chat-input-editor')?.textContent).toBe('hello');
    expect(document.execCommand).toHaveBeenCalledWith('insertText', false, 'hello');
  });

  it('rejects attachment delivery', async () => {
    renderKimiComposer();

    await expect(async () => {
      await kimiAdapter.composer?.setComposerPayload?.({
        text: 'hello',
        attachments: [{
          id: 'a1',
          name: 'sample.pdf',
          mime: 'application/pdf',
          size: 3,
        }],
      });
    }).rejects.toThrow('Provider does not support attachment delivery');
  });
});
