import { getAttachmentExtension, type AttachmentRef } from '../runtime/protocol';

export function fileInputAcceptsAttachments(
  input: HTMLInputElement,
  attachments: AttachmentRef[],
): boolean {
  const accept = input.getAttribute('accept')?.trim().toLowerCase();
  if (!accept) {
    return true;
  }

  const tokens = accept.split(',').map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0) {
    return true;
  }

  return attachments.every((attachment) => {
    const mime = attachment.mime.trim().toLowerCase();
    const extension = getAttachmentExtension(attachment.name);

    return tokens.some((token) => {
      if (extension && token === `.${extension}`) {
        return true;
      }

      if (mime && token === mime) {
        return true;
      }

      return token.endsWith('/*') && mime.startsWith(`${token.slice(0, -1)}`);
    });
  });
}

export function fileInputCanAcceptCount(input: HTMLInputElement, attachmentCount: number): boolean {
  return input.multiple || attachmentCount <= 1;
}

export function preferFileInputForAttachmentCount(
  inputs: HTMLInputElement[],
  attachmentCount: number,
): HTMLInputElement | null {
  return inputs.find((input) => fileInputCanAcceptCount(input, attachmentCount)) ?? inputs[0] ?? null;
}
