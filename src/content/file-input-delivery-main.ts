import {
  ASK_EM_BRIDGE_SOURCE,
  ASK_EM_FILE_INPUT_DELIVERY_RESULT,
  ASK_EM_FILE_INPUT_TOKEN_ATTRIBUTE,
  type AskEmFileInputDeliveryResultMessage,
  isAskEmFileInputDeliveryMessage,
} from '../runtime/protocol';

type FileInputDeliveryBridgeState = {
  installed: boolean;
  listener: (event: MessageEvent) => void;
};

declare global {
  interface Window {
    __ASK_EM_FILE_INPUT_DELIVERY_BRIDGE__?: FileInputDeliveryBridgeState;
  }
}

function getPostMessageTargetOrigin(): string {
  return window.location.origin && window.location.origin !== 'null' ? window.location.origin : '*';
}

function findTokenizedFileInput(inputToken: string): HTMLInputElement | null {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'))
    .find((input) => input.getAttribute(ASK_EM_FILE_INPUT_TOKEN_ATTRIBUTE) === inputToken) ?? null;
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

function postResult(requestId: string, result: Omit<AskEmFileInputDeliveryResultMessage, 'source' | 'type' | 'requestId'>) {
  window.postMessage({
    source: ASK_EM_BRIDGE_SOURCE,
    type: ASK_EM_FILE_INPUT_DELIVERY_RESULT,
    requestId,
    ...result,
  } satisfies AskEmFileInputDeliveryResultMessage, getPostMessageTargetOrigin());
}

export function installFileInputDeliveryBridge(): () => void {
  const existing = window.__ASK_EM_FILE_INPUT_DELIVERY_BRIDGE__;
  if (existing?.installed) {
    return () => undefined;
  }

  const listener = (event: MessageEvent) => {
    if ((event.source && event.source !== window) || !isAskEmFileInputDeliveryMessage(event.data)) {
      return;
    }

    const input = findTokenizedFileInput(event.data.inputToken);
    if (!input) {
      postResult(event.data.requestId, {
        ok: false,
        error: 'upload input not found',
      });
      return;
    }

    try {
      setNativeFileInputFiles(input, event.data.files);
      postResult(event.data.requestId, { ok: true });
    } catch (error) {
      postResult(event.data.requestId, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const state: FileInputDeliveryBridgeState = {
    installed: true,
    listener,
  };
  window.__ASK_EM_FILE_INPUT_DELIVERY_BRIDGE__ = state;
  window.addEventListener('message', listener);

  return () => {
    if (window.__ASK_EM_FILE_INPUT_DELIVERY_BRIDGE__ !== state) {
      return;
    }

    window.removeEventListener('message', listener);
    state.installed = false;
    delete window.__ASK_EM_FILE_INPUT_DELIVERY_BRIDGE__;
  };
}
