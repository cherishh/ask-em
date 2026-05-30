import {
  ASK_EM_BRIDGE_SOURCE,
  ATTACHMENT_CHUNK_BYTES,
  ASK_EM_FILE_INPUT_DELIVERY,
  ASK_EM_FILE_INPUT_TOKEN_ATTRIBUTE,
  ASK_EM_TRANSIENT_FILE_INPUT_DELIVERY,
  type AttachmentReadChunkResponse,
  type AttachmentRef,
  type AskEmFileInputDeliveryMessage,
  type AskEmTransientFileInputDeliveryMessage,
  isAskEmFileInputDeliveryResultMessage,
  isAskEmTransientFileInputDeliveryResultMessage,
} from '../runtime/protocol';
import { base64ToArrayBuffer } from '../runtime/base64-chunk';

const FILE_INPUT_DELIVERY_TIMEOUT_MS = 2_000;
const TRANSIENT_FILE_INPUT_DELIVERY_TIMEOUT_MS = 6_000;

function createDeliveryRequestId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `file-delivery-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

function createDataTransferWithFiles(files: File[]): DataTransfer {
  if (typeof DataTransfer === 'function') {
    const dataTransfer = new DataTransfer();
    for (const file of files) {
      dataTransfer.items.add(file);
    }

    return dataTransfer;
  }

  return {
    files,
    items: files.map((file) => ({
      kind: 'file',
      type: file.type,
      getAsFile: () => file,
    })),
  } as unknown as DataTransfer;
}

function getPostMessageTargetOrigin(): string {
  return window.location.origin && window.location.origin !== 'null' ? window.location.origin : '*';
}

function waitForFileInputDeliveryResult(requestId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('upload bridge unavailable'));
    }, FILE_INPUT_DELIVERY_TIMEOUT_MS);

    const listener = (event: MessageEvent) => {
      if (
        (event.source && event.source !== window) ||
        (event.origin && event.origin !== window.location.origin) ||
        !isAskEmFileInputDeliveryResultMessage(event.data)
      ) {
        return;
      }

      if (event.data.requestId !== requestId) {
        return;
      }

      cleanup();
      if (event.data.ok) {
        resolve();
      } else {
        reject(new Error(event.data.error ?? 'upload failed'));
      }
    };

    function cleanup() {
      window.clearTimeout(timeout);
      window.removeEventListener('message', listener);
    }

    window.addEventListener('message', listener);
  });
}

function waitForTransientFileInputDeliveryResult(requestId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('upload bridge unavailable'));
    }, TRANSIENT_FILE_INPUT_DELIVERY_TIMEOUT_MS);

    const listener = (event: MessageEvent) => {
      if (
        (event.source && event.source !== window) ||
        (event.origin && event.origin !== window.location.origin) ||
        !isAskEmTransientFileInputDeliveryResultMessage(event.data)
      ) {
        return;
      }

      if (event.data.requestId !== requestId) {
        return;
      }

      cleanup();
      if (event.data.ok) {
        resolve();
      } else {
        reject(new Error(event.data.error ?? 'upload failed'));
      }
    };

    function cleanup() {
      window.clearTimeout(timeout);
      window.removeEventListener('message', listener);
    }

    window.addEventListener('message', listener);
  });
}

export async function readAttachmentFile(ref: AttachmentRef): Promise<File> {
  const parts: ArrayBuffer[] = [];
  let offset = 0;

  while (true) {
    const response = (await chrome.runtime.sendMessage({
      type: 'ATTACHMENT_READ_CHUNK',
      attachmentId: ref.id,
      offset,
      maxBytes: ATTACHMENT_CHUNK_BYTES,
    })) as { ok?: boolean; chunk?: AttachmentReadChunkResponse; error?: string } | undefined;

    if (!response?.ok || !response.chunk) {
      throw new Error(response?.error ?? 'failed to read attachment');
    }

    parts.push(base64ToArrayBuffer(response.chunk.chunkBase64));
    offset = response.chunk.nextOffset;

    if (response.chunk.done) {
      break;
    }
  }

  return new File(parts, ref.name, { type: ref.mime });
}

export async function readAttachmentFiles(refs: AttachmentRef[]): Promise<File[]> {
  const files: File[] = [];

  for (const ref of refs) {
    files.push(await readAttachmentFile(ref));
  }

  return files;
}

export function setFileInputFiles(input: HTMLInputElement, files: File[]): Promise<void> {
  const requestId = createDeliveryRequestId();
  input.setAttribute(ASK_EM_FILE_INPUT_TOKEN_ATTRIBUTE, requestId);

  const result = waitForFileInputDeliveryResult(requestId);
  window.postMessage({
    source: ASK_EM_BRIDGE_SOURCE,
    type: ASK_EM_FILE_INPUT_DELIVERY,
    requestId,
    inputToken: requestId,
    files,
  } satisfies AskEmFileInputDeliveryMessage, getPostMessageTargetOrigin());

  return result.finally(() => {
    input.removeAttribute(ASK_EM_FILE_INPUT_TOKEN_ATTRIBUTE);
  });
}

export async function setNextTransientFileInputFiles(
  files: File[],
  triggerInputClick: () => Promise<void> | void,
  options: {
    awaitDeliveryResult?: boolean;
  } = {},
): Promise<void> {
  const requestId = createDeliveryRequestId();
  const shouldAwaitDeliveryResult = options.awaitDeliveryResult ?? true;
  const result = shouldAwaitDeliveryResult
    ? waitForTransientFileInputDeliveryResult(requestId)
    : null;
  window.postMessage({
    source: ASK_EM_BRIDGE_SOURCE,
    type: ASK_EM_TRANSIENT_FILE_INPUT_DELIVERY,
    requestId,
    files,
  } satisfies AskEmTransientFileInputDeliveryMessage, getPostMessageTargetOrigin());
  await new Promise((resolve) => window.setTimeout(resolve, 0));

  try {
    await triggerInputClick();
  } catch (error) {
    void result?.catch(() => undefined);
    throw error;
  }

  if (!shouldAwaitDeliveryResult) {
    return;
  }

  await result;
}

export function dispatchPasteFiles(target: HTMLElement, files: File[]): void {
  const clipboardData = createDataTransferWithFiles(files);
  let event: Event;

  if (typeof ClipboardEvent === 'function') {
    event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData,
    });
  } else {
    event = new Event('paste', {
      bubbles: true,
      cancelable: true,
    });
  }

  if (!(event as ClipboardEvent).clipboardData) {
    Object.defineProperty(event, 'clipboardData', {
      configurable: true,
      value: clipboardData,
    });
  }

  target.focus();
  target.dispatchEvent(event);
}
