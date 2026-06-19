// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDomProviderAdapter } from './factory';

const PASTED_TEXT_ATTACHMENT_MIN_CHARS = 5_000;

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

describe('dom provider adapter submit detection', () => {
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    document.body.innerHTML = '';
    rectSpy = mockVisibleLayout();
  });

  afterEach(() => {
    rectSpy.mockRestore();
    document.body.innerHTML = '';
  });

  it('does not treat clicks on a disabled send button as a user submit', () => {
    document.body.innerHTML = `
      <div id="composer" contenteditable="true">hello</div>
      <button id="send" disabled>Send</button>
    `;

    const onSubmit = vi.fn();
    const adapter = createDomProviderAdapter({
      provider: 'chatgpt',
      mountId: 'ask-em-chatgpt-ui',
      className: 'ask-em-chatgpt-ui',
      composerSelectors: ['#composer'],
      sendButtonSelectors: ['#send'],
    });

    const unsubscribe = adapter.composer?.subscribeToUserSubmissions?.(onSubmit);
    document.getElementById('send')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSubmit).not.toHaveBeenCalled();
    unsubscribe?.();
  });

  it('still treats clicks on an enabled send button as a user submit', () => {
    document.body.innerHTML = `
      <div id="composer" contenteditable="true">hello</div>
      <button id="send">Send</button>
    `;

    const onSubmit = vi.fn();
    const adapter = createDomProviderAdapter({
      provider: 'chatgpt',
      mountId: 'ask-em-chatgpt-ui',
      className: 'ask-em-chatgpt-ui',
      composerSelectors: ['#composer'],
      sendButtonSelectors: ['#send'],
    });

    const unsubscribe = adapter.composer?.subscribeToUserSubmissions?.(onSubmit);
    document.getElementById('send')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello',
      attachments: [],
      onConsumed: expect.any(Function),
    }));
    unsubscribe?.();
  });

  it('lets providers observe source-only submit buttons without changing delivery submit', async () => {
    document.body.innerHTML = `
      <div id="composer" contenteditable="true">voice text</div>
      <button id="send">Send</button>
      <button id="dictation-send">Submit dictation</button>
    `;

    const onSubmit = vi.fn();
    const clicked: string[] = [];
    document.getElementById('send')?.addEventListener('click', () => {
      clicked.push('send');
    });
    document.getElementById('dictation-send')?.addEventListener('click', () => {
      clicked.push('dictation');
    });
    const adapter = createDomProviderAdapter({
      provider: 'chatgpt',
      mountId: 'ask-em-chatgpt-ui',
      className: 'ask-em-chatgpt-ui',
      composerSelectors: ['#composer'],
      sendButtonSelectors: ['#send'],
      findUserSubmitButtons: () => Array.from(document.querySelectorAll<HTMLElement>('#send, #dictation-send')),
    });

    const unsubscribe = adapter.composer?.subscribeToUserSubmissions?.(onSubmit);
    document.getElementById('dictation-send')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      text: 'voice text',
      attachments: [],
      onConsumed: expect.any(Function),
    }));

    await adapter.composer?.submit({ timeoutMs: 10 });

    expect(clicked).toEqual(['dictation', 'send']);
    unsubscribe?.();
  });

  it('recovers text from a newly inserted user message when a source submit clears the composer first', async () => {
    document.body.innerHTML = `
      <main>
        <div class="user-message">previous</div>
      </main>
      <div id="composer" contenteditable="true"></div>
      <button id="dictation-send">Submit dictation</button>
    `;

    const onSubmit = vi.fn();
    const adapter = createDomProviderAdapter({
      provider: 'chatgpt',
      mountId: 'ask-em-chatgpt-ui',
      className: 'ask-em-chatgpt-ui',
      composerSelectors: ['#composer'],
      sendButtonSelectors: [],
      findUserSubmitButtons: () => [document.getElementById('dictation-send') as HTMLElement],
      getUserMessageTexts: () => Array.from(document.querySelectorAll<HTMLElement>('.user-message'))
        .map((element) => element.textContent ?? ''),
      deferredUserSubmitTextTimeoutMs: 500,
    });

    const unsubscribe = adapter.composer?.subscribeToUserSubmissions?.(onSubmit);
    document.getElementById('dictation-send')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.querySelector('main')?.insertAdjacentHTML('beforeend', '<div class="user-message">dictated later</div>');

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        text: 'dictated later',
        attachments: [],
      }));
    });
    unsubscribe?.();
  });

  it('uses the pre-click baseline when a dictation submit inserts the message before click handlers run', async () => {
    document.body.innerHTML = `
      <main>
        <div class="user-message">previous</div>
      </main>
      <div id="composer" contenteditable="true"></div>
      <button id="dictation-send">Submit dictation</button>
    `;

    const onSubmit = vi.fn();
    const adapter = createDomProviderAdapter({
      provider: 'chatgpt',
      mountId: 'ask-em-chatgpt-ui',
      className: 'ask-em-chatgpt-ui',
      composerSelectors: ['#composer'],
      sendButtonSelectors: [],
      findUserSubmitButtons: () => [document.getElementById('dictation-send') as HTMLElement],
      getUserMessageTexts: () => Array.from(document.querySelectorAll<HTMLElement>('.user-message'))
        .map((element) => element.textContent ?? ''),
      deferredUserSubmitTextTimeoutMs: 500,
    });

    const unsubscribe = adapter.composer?.subscribeToUserSubmissions?.(onSubmit);
    document.getElementById('dictation-send')?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    document.querySelector('main')?.insertAdjacentHTML('beforeend', '<div class="user-message">already inserted</div>');
    document.getElementById('dictation-send')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        text: 'already inserted',
        attachments: [],
      }));
    });
    unsubscribe?.();
  });

  it('does not recover deferred submit text from a label-only user message', async () => {
    document.body.innerHTML = `
      <main>
        <div class="user-message">previous</div>
      </main>
      <div id="composer" contenteditable="true"></div>
      <button id="dictation-send">Submit dictation</button>
    `;

    const onSubmit = vi.fn();
    const adapter = createDomProviderAdapter({
      provider: 'chatgpt',
      mountId: 'ask-em-chatgpt-ui',
      className: 'ask-em-chatgpt-ui',
      composerSelectors: ['#composer'],
      sendButtonSelectors: [],
      findUserSubmitButtons: () => [document.getElementById('dictation-send') as HTMLElement],
      getUserMessageTexts: () => Array.from(document.querySelectorAll<HTMLElement>('.user-message'))
        .map((element) => element.textContent ?? ''),
      deferredUserSubmitTextTimeoutMs: 500,
    });

    const unsubscribe = adapter.composer?.subscribeToUserSubmissions?.(onSubmit);
    document.getElementById('dictation-send')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.querySelector('main')?.insertAdjacentHTML('beforeend', '<div class="user-message">You said</div>');
    await Promise.resolve();

    expect(onSubmit).not.toHaveBeenCalled();
    document.querySelector<HTMLElement>('.user-message:last-child')?.append(' actual dictated text');

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        text: 'You said actual dictated text',
        attachments: [],
      }));
    });
    unsubscribe?.();
  });

  it('reports private mode as not sync-eligible', () => {
    document.body.innerHTML = `
      <div id="composer" contenteditable="true">hello</div>
      <button id="send">Send</button>
    `;

    const adapter = createDomProviderAdapter({
      provider: 'chatgpt',
      mountId: 'ask-em-chatgpt-ui',
      className: 'ask-em-chatgpt-ui',
      composerSelectors: ['#composer'],
      sendButtonSelectors: ['#send'],
      isPrivateMode: () => true,
    });

    expect(adapter.session.getStatus().pageState).toBe('private-mode');
  });

  it('keeps chat transcript error keywords from changing provider health', () => {
    document.body.innerHTML = `
      <main>
        <table>
          <tbody>
            <tr><td>404 Not Found</td></tr>
            <tr><td>An unknown error occurred. Please try again later.</td></tr>
          </tbody>
        </table>
      </main>
      <div id="composer" contenteditable="true"></div>
      <button id="send">Send</button>
    `;

    const adapter = createDomProviderAdapter({
      provider: 'chatgpt',
      mountId: 'ask-em-chatgpt-ui',
      className: 'ask-em-chatgpt-ui',
      composerSelectors: ['#composer'],
      sendButtonSelectors: ['#send'],
    });

    expect(adapter.session.getStatus().pageState).toBe('ready');
  });

  it('lets providers opt into explicit hard error classification', () => {
    document.body.innerHTML = `
      <div id="composer" contenteditable="true">hello</div>
      <button id="send">Send</button>
    `;

    const adapter = createDomProviderAdapter({
      provider: 'chatgpt',
      mountId: 'ask-em-chatgpt-ui',
      className: 'ask-em-chatgpt-ui',
      composerSelectors: ['#composer'],
      sendButtonSelectors: ['#send'],
      isErrorPage: () => true,
    });

    expect(adapter.session.getStatus().pageState).toBe('error');
  });

  it('captures stable file input changes when a submit-time source preview is present', () => {
    document.body.innerHTML = `
      <form>
        <div id="composer" contenteditable="true">hello</div>
        <div data-testid="attachment-card">sample.pdf</div>
        <input id="file" type="file" />
        <button id="send" type="button">Send</button>
      </form>
    `;

    const file = new File(['abc'], 'sample.pdf', { type: 'application/pdf' });
    const input = document.getElementById('file') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [file],
    });

    const onSubmit = vi.fn();
    const adapter = createDomProviderAdapter({
      provider: 'chatgpt',
      mountId: 'ask-em-chatgpt-ui',
      className: 'ask-em-chatgpt-ui',
      composerSelectors: ['#composer'],
      sendButtonSelectors: ['#send'],
      useGenericAttachmentSnapshot: true,
    });

    const unsubscribe = adapter.composer?.subscribeToUserSubmissions?.(onSubmit);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('send')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello',
      attachments: [
        expect.objectContaining({
          file,
          name: 'sample.pdf',
          mime: 'application/pdf',
          size: 3,
          source: 'file-input',
        }),
      ],
      onConsumed: expect.any(Function),
    }));
    unsubscribe?.();
  });

  it('does not trust stale file input files without a submit-time source preview', () => {
    document.body.innerHTML = `
      <form>
        <div id="composer" contenteditable="true">hello</div>
        <input id="file" type="file" />
        <button id="send" type="button">Send</button>
      </form>
    `;

    const input = document.getElementById('file') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['abc'], 'stale.pdf', { type: 'application/pdf' })],
    });

    const onSubmit = vi.fn();
    const adapter = createDomProviderAdapter({
      provider: 'chatgpt',
      mountId: 'ask-em-chatgpt-ui',
      className: 'ask-em-chatgpt-ui',
      composerSelectors: ['#composer'],
      sendButtonSelectors: ['#send'],
      useGenericAttachmentSnapshot: true,
    });

    const unsubscribe = adapter.composer?.subscribeToUserSubmissions?.(onSubmit);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('send')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello',
      attachments: [],
      attachmentResolution: expect.objectContaining({
        capturedCount: 1,
        currentCount: 0,
        submittedCount: 0,
        reason: 'no-current-attachments',
      }),
    }));
    unsubscribe?.();
  });

  it('recovers scoped file input files at submit time when the change event was missed', () => {
    document.body.innerHTML = `
      <form>
        <div id="composer" contenteditable="true">hello</div>
        <div data-testid="attachment-card">late.pdf</div>
        <input id="file" type="file" />
        <button id="send" type="button">Send</button>
      </form>
    `;

    const file = new File(['abc'], 'late.pdf', { type: 'application/pdf' });
    const input = document.getElementById('file') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [file],
    });

    const onSubmit = vi.fn();
    const adapter = createDomProviderAdapter({
      provider: 'chatgpt',
      mountId: 'ask-em-chatgpt-ui',
      className: 'ask-em-chatgpt-ui',
      composerSelectors: ['#composer'],
      sendButtonSelectors: ['#send'],
      useGenericAttachmentSnapshot: true,
    });

    const unsubscribe = adapter.composer?.subscribeToUserSubmissions?.(onSubmit);
    document.getElementById('send')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello',
      attachments: [
        expect.objectContaining({
          file,
          name: 'late.pdf',
          mime: 'application/pdf',
          size: 3,
          source: 'file-input',
        }),
      ],
      attachmentResolution: expect.objectContaining({
        capturedCount: 1,
        currentCount: 1,
        submittedCount: 1,
      }),
      onConsumed: expect.any(Function),
    }));
    unsubscribe?.();
  });

  it('does not recover late file input files without a submit-time source preview', () => {
    document.body.innerHTML = `
      <form>
        <div id="composer" contenteditable="true">hello</div>
        <input id="file" type="file" />
        <button id="send" type="button">Send</button>
      </form>
    `;

    const input = document.getElementById('file') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['abc'], 'stale.pdf', { type: 'application/pdf' })],
    });

    const onSubmit = vi.fn();
    const adapter = createDomProviderAdapter({
      provider: 'chatgpt',
      mountId: 'ask-em-chatgpt-ui',
      className: 'ask-em-chatgpt-ui',
      composerSelectors: ['#composer'],
      sendButtonSelectors: ['#send'],
      useGenericAttachmentSnapshot: true,
    });

    const unsubscribe = adapter.composer?.subscribeToUserSubmissions?.(onSubmit);
    document.getElementById('send')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello',
      attachments: [],
      attachmentResolution: expect.objectContaining({
        capturedCount: 1,
        currentCount: 0,
        submittedCount: 0,
        reason: 'no-current-attachments',
      }),
    }));
    unsubscribe?.();
  });

  it('captures pasted files for the next submit', () => {
    document.body.innerHTML = `
      <div id="composer" contenteditable="true">hello</div>
      <div data-testid="attachment-card">pasted.png</div>
      <button id="send">Send</button>
    `;

    const file = new File(['abc'], 'pasted.png', { type: 'image/png' });
    const composer = document.getElementById('composer') as HTMLElement;
    const pasteEvent = new Event('paste', { bubbles: true });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        files: [file],
        items: [],
      },
    });

    const onSubmit = vi.fn();
    const adapter = createDomProviderAdapter({
      provider: 'chatgpt',
      mountId: 'ask-em-chatgpt-ui',
      className: 'ask-em-chatgpt-ui',
      composerSelectors: ['#composer'],
      sendButtonSelectors: ['#send'],
      useGenericAttachmentSnapshot: true,
    });

    const unsubscribe = adapter.composer?.subscribeToUserSubmissions?.(onSubmit);
    composer.dispatchEvent(pasteEvent);
    document.getElementById('send')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello',
      attachments: [
        expect.objectContaining({
          file,
          name: 'pasted.png',
          mime: 'image/png',
          source: 'paste',
        }),
      ],
      onConsumed: expect.any(Function),
    }));
    unsubscribe?.();
  });

  it('captures long pasted text when the provider turns it into an attachment', async () => {
    document.body.innerHTML = `
      <div id="composer" contenteditable="true">typed after paste</div>
      <button id="send">Send</button>
    `;

    const text = 'log line\n'.repeat(Math.ceil(PASTED_TEXT_ATTACHMENT_MIN_CHARS / 9));
    const composer = document.getElementById('composer') as HTMLElement;
    const pasteEvent = new Event('paste', { bubbles: true });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        files: [],
        items: [],
        getData: (type: string) => type === 'text/plain' ? text : '',
      },
    });

    const onSubmit = vi.fn();
    const adapter = createDomProviderAdapter({
      provider: 'chatgpt',
      mountId: 'ask-em-chatgpt-ui',
      className: 'ask-em-chatgpt-ui',
      composerSelectors: ['#composer'],
      sendButtonSelectors: ['#send'],
      pastedTextAttachmentMinChars: PASTED_TEXT_ATTACHMENT_MIN_CHARS,
      getComposerAttachmentSnapshot: () => ({
        count: 1,
        items: ['Pasted text'],
      }),
    });

    const unsubscribe = adapter.composer?.subscribeToUserSubmissions?.(onSubmit);
    composer.dispatchEvent(pasteEvent);
    document.getElementById('send')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const payload = onSubmit.mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      text: 'typed after paste',
      attachments: [
        expect.objectContaining({
          name: 'pasted-text-1.txt',
          mime: 'text/plain',
          source: 'pasted-text',
        }),
      ],
      onConsumed: expect.any(Function),
    });
    await expect(payload.attachments[0].file.text()).resolves.toBe(text);
    unsubscribe?.();
  });

  it('does not submit stale captured files when the source composer no longer shows them', () => {
    document.body.innerHTML = `
      <div id="composer" contenteditable="true">hello</div>
      <button id="send">Send</button>
    `;

    const file = new File(['abc'], 'removed.png', { type: 'image/png' });
    const composer = document.getElementById('composer') as HTMLElement;
    const pasteEvent = new Event('paste', { bubbles: true });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        files: [file],
        items: [],
      },
    });

    const onSubmit = vi.fn();
    const adapter = createDomProviderAdapter({
      provider: 'chatgpt',
      mountId: 'ask-em-chatgpt-ui',
      className: 'ask-em-chatgpt-ui',
      composerSelectors: ['#composer'],
      sendButtonSelectors: ['#send'],
      useGenericAttachmentSnapshot: true,
    });

    const unsubscribe = adapter.composer?.subscribeToUserSubmissions?.(onSubmit);
    composer.dispatchEvent(pasteEvent);
    document.getElementById('send')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello',
      attachments: [],
      attachmentResolution: expect.objectContaining({
        capturedCount: 1,
        currentCount: null,
        submittedCount: 0,
        reason: 'missing-source-snapshot',
      }),
    }));
    unsubscribe?.();
  });

  it('does not use generic submit-time attachment labels unless explicitly opted in', () => {
    document.body.innerHTML = `
      <div id="composer" contenteditable="true">hello</div>
      <div data-testid="attachment-card">sample.pdf</div>
      <button id="send">Send</button>
    `;

    const file = new File(['abc'], 'sample.pdf', { type: 'application/pdf' });
    const composer = document.getElementById('composer') as HTMLElement;
    const pasteEvent = new Event('paste', { bubbles: true });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        files: [file],
        items: [],
      },
    });

    const onSubmit = vi.fn();
    const adapter = createDomProviderAdapter({
      provider: 'chatgpt',
      mountId: 'ask-em-chatgpt-ui',
      className: 'ask-em-chatgpt-ui',
      composerSelectors: ['#composer'],
      sendButtonSelectors: ['#send'],
    });

    const unsubscribe = adapter.composer?.subscribeToUserSubmissions?.(onSubmit);
    composer.dispatchEvent(pasteEvent);
    document.getElementById('send')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello',
      attachments: [],
      attachmentResolution: expect.objectContaining({
        capturedCount: 1,
        currentCount: null,
        submittedCount: 0,
        reason: 'missing-source-snapshot',
      }),
    }));
    unsubscribe?.();
  });

  it('uses the submit-time source snapshot to filter removed files', () => {
    document.body.innerHTML = `
      <div id="composer" contenteditable="true">hello</div>
      <div data-testid="attachment-card">kept.png</div>
      <button id="send">Send</button>
    `;

    const composer = document.getElementById('composer') as HTMLElement;
    const onSubmit = vi.fn();
    const adapter = createDomProviderAdapter({
      provider: 'chatgpt',
      mountId: 'ask-em-chatgpt-ui',
      className: 'ask-em-chatgpt-ui',
      composerSelectors: ['#composer'],
      sendButtonSelectors: ['#send'],
      useGenericAttachmentSnapshot: true,
    });

    const unsubscribe = adapter.composer?.subscribeToUserSubmissions?.(onSubmit);
    for (const file of [
      new File(['abc'], 'removed.png', { type: 'image/png' }),
      new File(['abc'], 'kept.png', { type: 'image/png' }),
    ]) {
      const pasteEvent = new Event('paste', { bubbles: true });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          files: [file],
          items: [],
        },
      });
      composer.dispatchEvent(pasteEvent);
    }
    document.getElementById('send')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello',
      attachments: [
        expect.objectContaining({
          file: expect.any(File),
          name: 'kept.png',
          mime: 'image/png',
          source: 'paste',
        }),
      ],
      attachmentResolution: expect.objectContaining({
        capturedCount: 2,
        currentCount: 1,
        submittedCount: 1,
      }),
    }));
    unsubscribe?.();
  });

  it('captures bridged transient input files for the next submit', () => {
    document.body.innerHTML = `
      <div id="composer" contenteditable="true">hello</div>
      <div data-testid="attachment-card">transient.pdf</div>
      <button id="send">Send</button>
    `;

    const file = new File(['abc'], 'transient.pdf', { type: 'application/pdf' });
    const onSubmit = vi.fn();
    const adapter = createDomProviderAdapter({
      provider: 'manus',
      mountId: 'ask-em-manus-ui',
      className: 'ask-em-manus-ui',
      composerSelectors: ['#composer'],
      sendButtonSelectors: ['#send'],
      useGenericAttachmentSnapshot: true,
    });

    const unsubscribe = adapter.composer?.subscribeToUserSubmissions?.(onSubmit);
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          source: 'ask-em',
          type: 'ASK_EM_TRANSIENT_FILES',
          files: [file],
        },
      }),
    );
    document.getElementById('send')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello',
      attachments: [
        expect.objectContaining({
          file,
          name: 'transient.pdf',
          mime: 'application/pdf',
          source: 'transient-file-input',
        }),
      ],
      onConsumed: expect.any(Function),
    }));
    unsubscribe?.();
  });

  it('filters captured files when a scoped file input resets before submit', () => {
    document.body.innerHTML = `
      <form>
        <div id="composer" contenteditable="true">hello</div>
        <input id="file" type="file" />
        <button id="send" type="button">Send</button>
      </form>
    `;

    const input = document.getElementById('file') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['abc'], 'sample.pdf', { type: 'application/pdf' })],
    });

    const onSubmit = vi.fn();
    const adapter = createDomProviderAdapter({
      provider: 'chatgpt',
      mountId: 'ask-em-chatgpt-ui',
      className: 'ask-em-chatgpt-ui',
      composerSelectors: ['#composer'],
      sendButtonSelectors: ['#send'],
      useGenericAttachmentSnapshot: true,
    });

    const unsubscribe = adapter.composer?.subscribeToUserSubmissions?.(onSubmit);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [],
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('send')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello',
      attachments: [],
      onConsumed: expect.any(Function),
    }));
    unsubscribe?.();
  });
});
