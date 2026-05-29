import {
  ASK_EM_BRIDGE_SOURCE,
  ASK_EM_TRANSIENT_FILES,
  type AskEmTransientFilesMessage,
} from '../runtime/protocol';

type TransientHookState = {
  installed: boolean;
  originalClick: typeof HTMLInputElement.prototype.click;
};

declare global {
  interface Window {
    __ASK_EM_TRANSIENT_FILE_INPUT_HOOK__?: TransientHookState;
  }
}

function postTransientFiles(files: File[]) {
  if (files.length === 0) {
    return;
  }

  const message: AskEmTransientFilesMessage = {
    source: ASK_EM_BRIDGE_SOURCE,
    type: ASK_EM_TRANSIENT_FILES,
    files,
  };

  window.postMessage(message, window.location.origin);
}

export function installTransientFileInputHook(): () => void {
  const existing = window.__ASK_EM_TRANSIENT_FILE_INPUT_HOOK__;
  if (existing?.installed) {
    return () => undefined;
  }

  const originalClick = HTMLInputElement.prototype.click;
  const state: TransientHookState = {
    installed: true,
    originalClick,
  };
  window.__ASK_EM_TRANSIENT_FILE_INPUT_HOOK__ = state;

  HTMLInputElement.prototype.click = function patchedInputClick(this: HTMLInputElement) {
    if (this.type === 'file') {
      this.addEventListener(
        'change',
        () => {
          postTransientFiles(Array.from(this.files ?? []));
        },
        { once: true },
      );
    }

    return originalClick.call(this);
  };

  return () => {
    if (window.__ASK_EM_TRANSIENT_FILE_INPUT_HOOK__ !== state) {
      return;
    }

    HTMLInputElement.prototype.click = originalClick;
    state.installed = false;
    delete window.__ASK_EM_TRANSIENT_FILE_INPUT_HOOK__;
  };
}
