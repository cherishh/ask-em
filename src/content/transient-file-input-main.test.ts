// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTransientFileInputHook } from './transient-file-input-main';

describe('transient file input MAIN-world hook', () => {
  const originalClick = HTMLInputElement.prototype.click;
  let clickBeforeHook: typeof HTMLInputElement.prototype.click;

  beforeEach(() => {
    delete window.__ASK_EM_TRANSIENT_FILE_INPUT_HOOK__;
    HTMLInputElement.prototype.click = vi.fn();
    clickBeforeHook = HTMLInputElement.prototype.click;
  });

  afterEach(() => {
    HTMLInputElement.prototype.click = originalClick;
    delete window.__ASK_EM_TRANSIENT_FILE_INPUT_HOOK__;
    vi.restoreAllMocks();
  });

  it('posts selected files from a detached file input', () => {
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const teardown = installTransientFileInputHook();
    const input = document.createElement('input');
    input.type = 'file';
    const file = new File(['abc'], 'transient.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [file],
    });

    input.click();
    input.dispatchEvent(new Event('change'));

    expect(postMessage).toHaveBeenCalledWith({
      source: 'ask-em',
      type: 'ASK_EM_TRANSIENT_FILES',
      files: [file],
    }, window.location.origin);

    teardown();
    expect(HTMLInputElement.prototype.click).toBe(clickBeforeHook);
  });

  it('is idempotent', () => {
    const firstTeardown = installTransientFileInputHook();
    const patchedClick = HTMLInputElement.prototype.click;
    const secondTeardown = installTransientFileInputHook();

    expect(HTMLInputElement.prototype.click).toBe(patchedClick);

    secondTeardown();
    expect(HTMLInputElement.prototype.click).toBe(patchedClick);

    firstTeardown();
    expect(HTMLInputElement.prototype.click).toBe(clickBeforeHook);
  });
});
