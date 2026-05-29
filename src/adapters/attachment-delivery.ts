import {
  ATTACHMENT_CHUNK_BYTES,
  type AttachmentReadChunkResponse,
  type AttachmentRef,
} from '../runtime/protocol';

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
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

export function setFileInputFiles(input: HTMLInputElement, files: File[]) {
  if (typeof DataTransfer === 'function') {
    const dataTransfer = new DataTransfer();
    for (const file of files) {
      dataTransfer.items.add(file);
    }
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: dataTransfer.files,
    });
  } else {
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: files,
    });
  }

  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
