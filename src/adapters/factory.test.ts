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

    expect(onSubmit).toHaveBeenCalledWith('hello');
    unsubscribe?.();
  });
});
