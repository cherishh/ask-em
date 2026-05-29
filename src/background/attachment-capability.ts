import {
  ATTACHMENT_MAX_COUNT,
  getAttachmentExtension,
  isGenericAttachmentMime,
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
  const allowedMimes = new Set(capability.mimes.map((value) => value.toLowerCase()));

  if (mime && !isGenericAttachmentMime(mime) && allowedMimes.has(mime)) {
    return true;
  }

  if (!isGenericAttachmentMime(mime)) {
    return false;
  }

  const extension = getAttachmentExtension(attachment.name);
  if (!extension) {
    return false;
  }

  return (capability.extensions ?? []).some((value) => value.toLowerCase() === extension);
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
