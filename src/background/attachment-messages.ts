import type { RuntimeMessage } from '../runtime/protocol';
import {
  abortAttachments,
  appendAttachmentChunk,
  createAttachment,
  finalizeAttachment,
  readAttachmentChunk,
} from '../runtime/attachment-store';

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

export async function handleAttachmentMessage(
  message: AttachmentMessage,
  sender: chrome.runtime.MessageSender,
) {
  try {
    switch (message.type) {
      case 'ATTACHMENT_CREATE': {
        const ref = await createAttachment({
          submitId: message.submitId,
          ref: {
            id: message.id,
            name: message.name,
            mime: message.mime,
            size: message.size,
          },
          ownerTabId: sender.tab?.id,
        });
        return { ok: true, ref };
      }
      case 'ATTACHMENT_APPEND_CHUNK':
        await appendAttachmentChunk(message);
        return { ok: true };
      case 'ATTACHMENT_FINALIZE': {
        const ref = await finalizeAttachment(message);
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
        return { ok: true };
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
