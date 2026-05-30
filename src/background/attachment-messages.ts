import type { AttachmentRef, RuntimeMessage } from '../runtime/protocol';
import {
  abortAttachments,
  appendAttachmentChunk,
  createAttachment,
  finalizeAttachment,
  readAttachmentChunk,
} from '../runtime/attachment-store';
import { formatAttachmentSummary, shortAttachmentId, shortSubmitId } from '../runtime/attachment-log';
import { logDebug } from './debug';

type AttachmentMessage = Extract<
  RuntimeMessage,
  {
    type:
      | 'ATTACHMENT_CREATE'
      | 'ATTACHMENT_APPEND_CHUNK'
      | 'ATTACHMENT_FINALIZE'
      | 'ATTACHMENT_READ_CHUNK'
      | 'ATTACHMENT_ABORT';
  }
>;

async function logAttachmentDebug(entry: Parameters<typeof logDebug>[0]) {
  try {
    await logDebug(entry);
  } catch (error) {
    console.warn('ask-em: failed to append attachment debug log', error);
  }
}

function describeAttachmentCommand(message: AttachmentMessage): string {
  const parts = [`type=${message.type}`];

  if ('submitId' in message && message.submitId) {
    parts.push(`submit=${shortSubmitId(message.submitId)}`);
  }

  if (message.type === 'ATTACHMENT_CREATE') {
    parts.push(`attachment=${shortAttachmentId(message.id)}`);
  } else if ('attachmentId' in message) {
    parts.push(`attachment=${shortAttachmentId(message.attachmentId)}`);
  } else if (message.type === 'ATTACHMENT_ABORT' && message.ids) {
    parts.push(`attachments=${message.ids.map(shortAttachmentId).join(',')}`);
  }

  return parts.join('; ');
}

export async function handleAttachmentMessage(
  message: AttachmentMessage,
  sender: chrome.runtime.MessageSender,
) {
  try {
    switch (message.type) {
      case 'ATTACHMENT_CREATE': {
        const inputRef: AttachmentRef = {
          id: message.id,
          name: message.name,
          mime: message.mime,
          size: message.size,
        };

        const ref = await createAttachment({
          submitId: message.submitId,
          ref: inputRef,
          ownerTabId: sender.tab?.id,
        });
        await logAttachmentDebug({
          level: 'info',
          scope: 'background',
          message: 'Attachment store create',
          detail: `submit=${shortSubmitId(message.submitId)}; tab=${sender.tab?.id ?? 'unknown'}; ${formatAttachmentSummary([ref])}`,
        });
        return { ok: true, ref };
      }
      case 'ATTACHMENT_APPEND_CHUNK':
        await appendAttachmentChunk(message);
        return { ok: true };
      case 'ATTACHMENT_FINALIZE': {
        const ref = await finalizeAttachment(message);
        await logAttachmentDebug({
          level: 'info',
          scope: 'background',
          message: 'Attachment store finalize',
          detail: `submit=${shortSubmitId(message.submitId)}; ${formatAttachmentSummary([ref])}`,
        });
        return { ok: true, ref };
      }
      case 'ATTACHMENT_READ_CHUNK': {
        const chunk = await readAttachmentChunk(message);
        return { ok: true, chunk };
      }
      case 'ATTACHMENT_ABORT':
        if (message.submitId) {
          await abortAttachments({ submitId: message.submitId });
        } else if (message.ids) {
          await abortAttachments({ ids: message.ids });
        }
        await logAttachmentDebug({
          level: 'warn',
          scope: 'background',
          message: 'Attachment store abort',
          detail: describeAttachmentCommand(message),
        });
        return { ok: true };
    }
  } catch (error) {
    await logAttachmentDebug({
      level: 'warn',
      scope: 'background',
      message: 'Attachment store command failed',
      detail: `${describeAttachmentCommand(message)}; reason=${error instanceof Error ? error.message : String(error)}`,
    });
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
