import {
  ASK_EM_BRIDGE_SOURCE,
  ASK_EM_TRANSIENT_FILES,
  ASK_EM_TRANSIENT_FILE_INPUT_DELIVERY_RESULT,
  type AskEmTransientFilesMessage,
  type AskEmTransientFileInputDeliveryResultMessage,
  isAskEmTransientFileInputDeliveryMessage,
} from '../runtime/protocol';

const TRANSIENT_DELIVERY_TIMEOUT_MS = 5_000;

type TransientHookState = {
  installed: boolean;
  originalClick: typeof HTMLInputElement.prototype.click;
  listener: (event: MessageEvent) => void;
  pendingDelivery?: {
    requestId: string;
    files: File[];
    timeout: number;
  };
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

function postDeliveryResult(
  requestId: string,
  result: Omit<AskEmTransientFileInputDeliveryResultMessage, 'source' | 'type' | 'requestId'>,
) {
  window.postMessage({
    source: ASK_EM_BRIDGE_SOURCE,
    type: ASK_EM_TRANSIENT_FILE_INPUT_DELIVERY_RESULT,
    requestId,
    ...result,
  } satisfies AskEmTransientFileInputDeliveryResultMessage, window.location.origin);
}

function createFileList(files: File[]): FileList | File[] {
  if (typeof DataTransfer !== 'function') {
    return files;
  }

  const dataTransfer = new DataTransfer();
  for (const file of files) {
    dataTransfer.items.add(file);
  }

  return dataTransfer.files;
}

function setNativeFileInputFiles(input: HTMLInputElement, files: File[]) {
  const fileList = createFileList(files);

  try {
    input.files = fileList as FileList;
  } catch {
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: fileList,
    });
  }

  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
}

function clearPendingDelivery(state: TransientHookState) {
  if (!state.pendingDelivery) {
    return;
  }

  window.clearTimeout(state.pendingDelivery.timeout);
  state.pendingDelivery = undefined;
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
    listener(event) {
      if ((event.source && event.source !== window) || !isAskEmTransientFileInputDeliveryMessage(event.data)) {
        return;
      }

      clearPendingDelivery(state);
      const requestId = event.data.requestId;
      state.pendingDelivery = {
        requestId,
        files: event.data.files,
        timeout: window.setTimeout(() => {
          if (state.pendingDelivery?.requestId !== requestId) {
            return;
          }

          state.pendingDelivery = undefined;
          postDeliveryResult(requestId, {
            ok: false,
            error: 'upload input not found',
          });
        }, TRANSIENT_DELIVERY_TIMEOUT_MS),
      };
    },
  };
  window.__ASK_EM_TRANSIENT_FILE_INPUT_HOOK__ = state;
  window.addEventListener('message', state.listener);

  HTMLInputElement.prototype.click = function patchedInputClick(this: HTMLInputElement) {
    if (this.type === 'file') {
      const delivery = state.pendingDelivery;
      if (delivery) {
        clearPendingDelivery(state);
        try {
          setNativeFileInputFiles(this, delivery.files);
          postDeliveryResult(delivery.requestId, { ok: true });
        } catch (error) {
          postDeliveryResult(delivery.requestId, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return undefined;
      }

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

    clearPendingDelivery(state);
    window.removeEventListener('message', state.listener);
    HTMLInputElement.prototype.click = originalClick;
    state.installed = false;
    delete window.__ASK_EM_TRANSIENT_FILE_INPUT_HOOK__;
  };
}
