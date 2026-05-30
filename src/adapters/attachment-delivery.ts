import {
  ASK_EM_BRIDGE_SOURCE,
  ATTACHMENT_CHUNK_BYTES,
  ASK_EM_FILE_INPUT_DELIVERY,
  ASK_EM_FILE_INPUT_TOKEN_ATTRIBUTE,
  type AttachmentReadChunkResponse,
  type AttachmentRef,
  type AskEmFileInputDeliveryMessage,
  isAskEmFileInputDeliveryResultMessage,
} from '../runtime/protocol';

const FILE_INPUT_DELIVERY_TIMEOUT_MS = 2_000;

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

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
      if ((event.source && event.source !== window) || !isAskEmFileInputDeliveryResultMessage(event.data)) {
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
