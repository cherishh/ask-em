import {
  ATTACHMENT_MAX_COUNT,
  IMAGE_ATTACHMENT_MIME_PREFIX,
  getAttachmentExtension,
  isGenericAttachmentMime,
  isTextAttachmentExtension,
  isTextAttachmentMime,
  PROVIDER_UPLOAD_CAPABILITIES,
  type AttachmentRef,
  type Provider,
  type UploadCapability,
} from '../runtime/protocol';

export type AttachmentCapabilityResult =
  | { ok: true }
  | { ok: false; reason: string };

function isAttachmentAllowedByCapability(
  attachment: AttachmentRef,
  capability: Exclude<UploadCapability, null>,
): boolean {
  const mime = attachment.mime.trim().toLowerCase();
  const extension = getAttachmentExtension(attachment.name);
  const blockedMimes = new Set((capability.blockedMimes ?? []).map((value) => value.toLowerCase()));
  const blockedExtensions = new Set((capability.blockedExtensions ?? []).map((value) => value.toLowerCase()));

  if (extension && blockedExtensions.has(extension)) {
    return false;
  }

  if (
    mime &&
    !isGenericAttachmentMime(mime) &&
    (blockedMimes.has(mime) ||
      (capability.blockedMimePrefixes ?? []).some((prefix) => mime.startsWith(prefix.toLowerCase())))
  ) {
    return false;
  }

  if (capability.allowImages && mime.startsWith(IMAGE_ATTACHMENT_MIME_PREFIX)) {
    return true;
  }

  const documentMimes = new Set((capability.documentMimes ?? []).map((value) => value.toLowerCase()));
  if (mime && documentMimes.has(mime)) {
    return true;
  }

  const documentExtensions = new Set((capability.documentExtensions ?? []).map((value) => value.toLowerCase()));
  if (extension && documentExtensions.has(extension)) {
    return true;
  }

  if (!capability.allowPlainText) {
    return false;
  }

  if (attachment.isPlainText === true) {
    return true;
  }

  if (attachment.isPlainText === false) {
    return false;
  }

  if (mime && isTextAttachmentMime(mime)) {
    return true;
  }

  return isTextAttachmentExtension(extension);
}

export function checkProviderAttachmentCapability(
  provider: Provider,
  attachments: AttachmentRef[],
  capability = PROVIDER_UPLOAD_CAPABILITIES[provider],
): AttachmentCapabilityResult {
  if (attachments.length === 0) {
    return { ok: true };
  }

  if (!capability) {
    return { ok: false, reason: `${provider} attachment not supported` };
  }

  const maxFiles = Math.min(ATTACHMENT_MAX_COUNT, capability.maxFiles);
  if (attachments.length > maxFiles) {
    return { ok: false, reason: `${provider} attachment count not supported` };
  }

  const unsupported = attachments.find((attachment) =>
    !isAttachmentAllowedByCapability(attachment, capability),
  );

  if (unsupported) {
    return { ok: false, reason: `${provider} attachment type not supported` };
  }

  return { ok: true };
}
