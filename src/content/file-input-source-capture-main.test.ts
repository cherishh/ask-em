// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFileInputSourceCaptureHook } from './file-input-source-capture-main';

describe('MAIN-world file input source capture', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    delete window.__ASK_EM_FILE_INPUT_SOURCE_CAPTURE__;
    vi.restoreAllMocks();
  });

  it('signals selected files while the provider input still owns them', () => {
    document.body.innerHTML = '<input type="file" />';
    const input = document.querySelector('input') as HTMLInputElement;
    const file = new File(['abc'], 'sample.pdf', {
      type: 'application/pdf',
      lastModified: 123,
    });
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [file],
    });
    const uninstall = installFileInputSourceCaptureHook();
    const providerChangeHandler = vi.fn();
    const sourceCaptureHandler = vi.fn();
    document.addEventListener('change', providerChangeHandler);
    document.addEventListener(
      'ask-em:file-input-source-capture',
      sourceCaptureHandler,
    );

    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.remove();

    expect(providerChangeHandler).toHaveBeenCalledOnce();
    expect(sourceCaptureHandler).toHaveBeenCalledOnce();
    expect(window.__ASK_EM_FILE_INPUT_SOURCE_CAPTURE__).toMatchObject(
      {
        capturedCount: 1,
        lastCapture: 'sample.pdf:application/pdf:3b',
      },
    );
    document.removeEventListener('change', providerChangeHandler);
    document.removeEventListener(
      'ask-em:file-input-source-capture',
      sourceCaptureHandler,
    );
    uninstall();
  });

  it('ignores empty and disabled file inputs', () => {
    document.body.innerHTML = '<input type="file" disabled />';
    const input = document.querySelector('input') as HTMLInputElement;
    const sourceCaptureHandler = vi.fn();
    const uninstall = installFileInputSourceCaptureHook();
    document.addEventListener(
      'ask-em:file-input-source-capture',
      sourceCaptureHandler,
    );

    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(sourceCaptureHandler).not.toHaveBeenCalled();
    document.removeEventListener(
      'ask-em:file-input-source-capture',
      sourceCaptureHandler,
    );
    uninstall();
  });
});
