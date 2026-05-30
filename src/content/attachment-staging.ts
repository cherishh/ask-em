import {
  ATTACHMENT_CHUNK_BYTES,
  ATTACHMENT_MAX_COUNT,
  ATTACHMENT_MAX_FILE_BYTES,
  type AttachmentRef,
  type CapturedAttachment,
} from '../runtime/protocol';
import { isProbablyPlainTextBytes } from '../runtime/attachment-text';
import { sendRuntimeMessage } from './routing';

const TEXT_SNIFF_BYTES = 64 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const batchSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += batchSize) {
    const batch = bytes.subarray(offset, offset + batchSize);
    binary += String.fromCharCode(...batch);
  }

  return btoa(binary);
}

async function readFileBytes(file: File, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

async function isProbablyPlainTextFile(file: File): Promise<boolean> {
  const sample = await readFileBytes(file, 0, Math.min(file.size, TEXT_SNIFF_BYTES));
  return isProbablyPlainTextBytes(sample);
}

async function createAttachment(submitId: string, ref: AttachmentRef): Promise<void> {
  const response = await sendRuntimeMessage<{ ok?: boolean; error?: string }>({
    type: 'ATTACHMENT_CREATE',
    submitId,
    ...ref,
  });
  if (!response?.ok) {
    throw new Error(response?.error ?? 'failed to create attachment');
  }
}

async function appendAttachmentChunk(
  submitId: string,
  attachmentId: string,
  offset: number,
  chunk: Uint8Array,
): Promise<void> {
  const response = await sendRuntimeMessage<{ ok?: boolean; error?: string }>({
    type: 'ATTACHMENT_APPEND_CHUNK',
    submitId,
    attachmentId,
    offset,
    chunkBase64: bytesToBase64(chunk),
  });
  if (!response?.ok) {
    throw new Error(response?.error ?? 'failed to append attachment');
  }
}

async function finalizeAttachment(submitId: string, attachmentId: string): Promise<AttachmentRef> {
  const response = await sendRuntimeMessage<{ ok?: boolean; ref?: AttachmentRef; error?: string }>({
    type: 'ATTACHMENT_FINALIZE',
    submitId,
    attachmentId,
  });
  if (!response?.ok || !response.ref) {
    throw new Error(response?.error ?? 'failed to finalize attachment');
  }

  return response.ref;
}

async function abortSubmitAttachments(submitId: string): Promise<void> {
  await sendRuntimeMessage({
    type: 'ATTACHMENT_ABORT',
    submitId,
  });
}

async function appendFileChunks(submitId: string, attachment: CapturedAttachment): Promise<void> {
  for (let offset = 0; offset < attachment.size; offset += ATTACHMENT_CHUNK_BYTES) {
    const chunk = await readFileBytes(
      attachment.file,
      offset,
      Math.min(offset + ATTACHMENT_CHUNK_BYTES, attachment.size),
    );
    await appendAttachmentChunk(submitId, attachment.id, offset, chunk);
  }
}

export async function stageSubmitAttachments(
  submitId: string,
  attachments: CapturedAttachment[],
): Promise<AttachmentRef[]> {
  if (attachments.length === 0) {
    return [];
  }

  if (attachments.length > ATTACHMENT_MAX_COUNT) {
    throw new Error('too many files');
  }

  const refs: AttachmentRef[] = [];
  let createdAttachment = false;

  try {
    for (const attachment of attachments) {
      if (attachment.size > ATTACHMENT_MAX_FILE_BYTES) {
        throw new Error('attachment too large');
      }

      const ref: AttachmentRef = {
        id: attachment.id,
        name: attachment.name,
        mime: attachment.mime,
        size: attachment.size,
        isPlainText: await isProbablyPlainTextFile(attachment.file),
      };

      await createAttachment(submitId, ref);
      createdAttachment = true;
      await appendFileChunks(submitId, attachment);
      refs.push(await finalizeAttachment(submitId, attachment.id));
    }

    return refs;
  } catch (error) {
    if (createdAttachment) {
      await abortSubmitAttachments(submitId);
    }
    throw error;
  }
}
