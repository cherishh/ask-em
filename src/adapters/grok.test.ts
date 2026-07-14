// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFileInputDeliveryBridge } from '../content/file-input-delivery-main';
import { grokAdapter, isGrokChatRoute } from './grok';

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

function renderGrokComposer() {
  document.body.innerHTML = `
    <form>
      <input class="hidden" type="file" name="files" multiple />
      <div data-testid="chat-input">
        <div contenteditable="true" role="textbox" aria-label="Ask Grok anything"></div>
      </div>
      <div role="list" aria-label="Conversation attachments"></div>
      <button type="submit" aria-label="Submit" data-testid="chat-submit"></button>
    </form>
  `;
  document.querySelector('form')?.addEventListener('submit', (event) => event.preventDefault());
}

describe('Grok adapter', () => {
  let rectSpy: ReturnType<typeof vi.spyOn>;
  let uninstallFileInputDeliveryBridge: () => void;

  beforeEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/');
    rectSpy = mockVisibleLayout();
    uninstallFileInputDeliveryBridge = installFileInputDeliveryBridge();
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn(async () => ({
          ok: true,
          chunk: {
            attachmentId: 'a1',
            offset: 0,
            nextOffset: 3,
            chunkBase64: 'YWJj',
            done: true,
          },
        })),
      },
    });
  });

  afterEach(() => {
    uninstallFileInputDeliveryBridge();
    rectSpy.mockRestore();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/');
  });

  it('recognizes only Grok chat routes as interactive surfaces', () => {
    expect(isGrokChatRoute('https://grok.com/')).toBe(true);
    expect(isGrokChatRoute('https://grok.com/c/conversation-id')).toBe(true);
    expect(isGrokChatRoute('https://grok.com/imagine')).toBe(false);
    expect(isGrokChatRoute('https://grok.com/build')).toBe(false);
  });

  it('reports a normal new-chat composer as ready', () => {
    renderGrokComposer();

    expect(grokAdapter.session.getStatus()).toMatchObject({
      provider: 'grok',
      pageKind: 'new-chat',
      pageState: 'ready',
      sessionId: null,
    });
  });

  it('reports the anonymous composer with auth CTAs as login-required', () => {
    renderGrokComposer();
    document.body.insertAdjacentHTML(
      'afterbegin',
      '<button type="button">Sign in</button><button type="button">Sign up</button>',
    );

    expect(grokAdapter.session.getStatus()).toMatchObject({
      provider: 'grok',
      pageState: 'login-required',
    });
  });

  it('reports the post-submit sign-up gate as login-required', () => {
    document.body.innerHTML = `
      <h2>Continue your conversation</h2>
      <p>Sign up to continue seamlessly with Grok's full power</p>
      <button type="button">Sign up for free</button>
    `;

    expect(grokAdapter.session.getStatus()).toMatchObject({
      provider: 'grok',
      pageState: 'login-required',
    });
  });

  it('captures Grok submit clicks as user submissions', () => {
    renderGrokComposer();
    const composer = document.querySelector<HTMLElement>('[data-testid="chat-input"] [role="textbox"]');
    if (composer) {
      composer.textContent = 'hello Grok';
    }
    const onSubmit = vi.fn();
    const unsubscribe = grokAdapter.composer?.subscribeToUserSubmissions?.(onSubmit);

    document.querySelector<HTMLButtonElement>('[data-testid="chat-submit"]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello Grok',
      attachments: [],
    }));
    unsubscribe?.();
  });

  it('captures pasted images when the Grok preview exposes no filename', () => {
    renderGrokComposer();
    const composer = document.querySelector<HTMLElement>('[data-testid="chat-input"] [role="textbox"]');
    if (composer) {
      composer.textContent = 'describe this image';
    }
    document.querySelector('[aria-label="Conversation attachments"]')?.insertAdjacentHTML(
      'beforeend',
      '<div role="listitem"><button aria-label="Open attachment"><img alt="" src="blob:image" /></button></div>',
    );
    const file = new File(['abc'], 'clipboard-image.png', { type: 'image/png' });
    const pasteEvent = new Event('paste', { bubbles: true });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        files: [file],
        items: [],
      },
    });
    const onSubmit = vi.fn();
    const unsubscribe = grokAdapter.composer?.subscribeToUserSubmissions?.(onSubmit);

    composer?.dispatchEvent(pasteEvent);
    document.querySelector<HTMLButtonElement>('[data-testid="chat-submit"]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      text: 'describe this image',
      attachments: [
        expect.objectContaining({
          file,
          name: 'clipboard-image.png',
          source: 'paste',
        }),
      ],
      attachmentResolution: expect.objectContaining({
        capturedCount: 1,
        currentCount: 1,
        submittedCount: 1,
      }),
    }));
    unsubscribe?.();
  });

  it('sets text and injects reconstructed files through the Grok file input', async () => {
    renderGrokComposer();

    await grokAdapter.composer?.setComposerPayload?.({
      text: 'hello',
      attachments: [
        {
          id: 'a1',
          name: 'sample.pdf',
          mime: 'application/pdf',
          size: 3,
        },
      ],
    });

    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input?.files?.[0]).toEqual(expect.any(File));
    expect(input?.files?.[0]?.name).toBe('sample.pdf');
    expect(document.querySelector('[data-testid="chat-input"] [role="textbox"]')?.textContent).toBe('hello');
  });

  it('reports attachment presence from Grok conversation attachment items', async () => {
    renderGrokComposer();
    document.querySelector('[aria-label="Conversation attachments"]')?.insertAdjacentHTML(
      'beforeend',
      '<div role="listitem"><button aria-label="Open attachment">sample.pdf</button></div>',
    );

    await expect(Promise.resolve(grokAdapter.composer?.getComposerAttachmentPresence?.())).resolves.toEqual({
      count: 1,
      keys: ['sample.pdf'],
    });
  });
});
