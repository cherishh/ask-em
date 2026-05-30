// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ASK_EM_BRIDGE_SOURCE,
  ASK_EM_TRANSIENT_FILE_INPUT_DELIVERY,
  ASK_EM_TRANSIENT_FILE_INPUT_DELIVERY_RESULT,
} from '../runtime/protocol';
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
    vi.useRealTimers();
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

  it('delivers files into the next transient file input without opening the native picker', async () => {
    const postMessage = vi.spyOn(window, 'postMessage');
    const teardown = installTransientFileInputHook();
    const input = document.createElement('input');
    input.type = 'file';
    const file = new File(['abc'], 'target.pdf', { type: 'application/pdf' });
    let sawChange = false;
    input.addEventListener('change', () => {
      sawChange = true;
    });

    window.dispatchEvent(new MessageEvent('message', {
      data: {
        source: ASK_EM_BRIDGE_SOURCE,
        type: ASK_EM_TRANSIENT_FILE_INPUT_DELIVERY,
        requestId: 'delivery-1',
        files: [file],
      },
    }));
    input.click();

    expect(clickBeforeHook).not.toHaveBeenCalled();
    expect(sawChange).toBe(true);
    expect(input.files?.[0]?.name).toBe('target.pdf');
    expect(postMessage).toHaveBeenCalledWith({
      source: ASK_EM_BRIDGE_SOURCE,
      type: ASK_EM_TRANSIENT_FILE_INPUT_DELIVERY_RESULT,
      requestId: 'delivery-1',
      ok: true,
    }, window.location.origin);

    teardown();
  });

  it('reports a transient delivery timeout when no file input is clicked', () => {
    vi.useFakeTimers();
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const teardown = installTransientFileInputHook();
    const file = new File(['abc'], 'target.pdf', { type: 'application/pdf' });

    window.dispatchEvent(new MessageEvent('message', {
      data: {
        source: ASK_EM_BRIDGE_SOURCE,
        type: ASK_EM_TRANSIENT_FILE_INPUT_DELIVERY,
        requestId: 'delivery-timeout',
        files: [file],
      },
    }));
    vi.advanceTimersByTime(5_000);

    expect(postMessage).toHaveBeenCalledWith({
      source: ASK_EM_BRIDGE_SOURCE,
      type: ASK_EM_TRANSIENT_FILE_INPUT_DELIVERY_RESULT,
      requestId: 'delivery-timeout',
      ok: false,
      error: 'upload input not found',
    }, window.location.origin);

    teardown();
  });
});
