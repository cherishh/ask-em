import { ASK_EM_FILE_INPUT_SOURCE_CAPTURE_EVENT } from '../runtime/protocol';

type FileInputSourceCaptureState = {
  installed: boolean;
  listener: (event: Event) => void;
  capturedCount: number;
  lastCapture?: string;
};

declare global {
  interface Window {
    __ASK_EM_FILE_INPUT_SOURCE_CAPTURE__?: FileInputSourceCaptureState;
  }
}

// Kimi removes its teleported toolkit input soon after native file selection.
// Capture in MAIN world while the trusted change event still exposes FileList,
// then emit a private DOM event that the isolated content script can observe.
export function installFileInputSourceCaptureHook(): () => void {
  const existing = window.__ASK_EM_FILE_INPUT_SOURCE_CAPTURE__;
  if (existing?.installed) {
    return () => undefined;
  }

  const state: FileInputSourceCaptureState = {
    installed: true,
    capturedCount: 0,
    listener(event) {
      const input =
        event.target instanceof HTMLInputElement ? event.target : null;
      if (!input || input.type !== 'file' || input.disabled) {
        return;
      }

      const files = Array.from(input.files ?? []);
      if (files.length === 0) {
        return;
      }

      state.capturedCount += files.length;
      state.lastCapture = files
        .map((file) => `${file.name}:${file.type || 'unknown'}:${file.size}b`)
        .join(' | ');
      input.dispatchEvent(
        new CustomEvent(ASK_EM_FILE_INPUT_SOURCE_CAPTURE_EVENT, {
          bubbles: true,
          composed: true,
        }),
      );
    },
  };
  window.__ASK_EM_FILE_INPUT_SOURCE_CAPTURE__ = state;
  window.addEventListener('change', state.listener, true);

  return () => {
    if (window.__ASK_EM_FILE_INPUT_SOURCE_CAPTURE__ !== state) {
      return;
    }

    window.removeEventListener('change', state.listener, true);
    state.installed = false;
    delete window.__ASK_EM_FILE_INPUT_SOURCE_CAPTURE__;
  };
}
