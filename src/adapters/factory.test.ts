// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDomProviderAdapter } from './factory';

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

    expect(onSubmit).toHaveBeenCalledWith({
      text: 'hello',
      attachments: [],
      onConsumed: expect.any(Function),
    });
    unsubscribe?.();
  });

  it('captures stable file input changes for the next submit', () => {
    document.body.innerHTML = `
      <form>
        <div id="composer" contenteditable="true">hello</div>
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
    });

    const unsubscribe = adapter.composer?.subscribeToUserSubmissions?.(onSubmit);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('send')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSubmit).toHaveBeenCalledWith({
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
    });
    unsubscribe?.();
  });

  it('captures pasted files for the next submit', () => {
    document.body.innerHTML = `
      <div id="composer" contenteditable="true">hello</div>
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
    });

    const unsubscribe = adapter.composer?.subscribeToUserSubmissions?.(onSubmit);
    composer.dispatchEvent(pasteEvent);
    document.getElementById('send')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSubmit).toHaveBeenCalledWith({
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
    });
    unsubscribe?.();
  });

  it('captures bridged transient input files for the next submit', () => {
    document.body.innerHTML = `
      <div id="composer" contenteditable="true">hello</div>
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

    expect(onSubmit).toHaveBeenCalledWith({
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
    });
    unsubscribe?.();
  });

  it('invalidates captured files when a scoped file input resets', () => {
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
    });

    const unsubscribe = adapter.composer?.subscribeToUserSubmissions?.(onSubmit);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [],
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('send')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSubmit).toHaveBeenCalledWith({
      text: 'hello',
      attachments: [],
      onConsumed: expect.any(Function),
    });
    unsubscribe?.();
  });
});
