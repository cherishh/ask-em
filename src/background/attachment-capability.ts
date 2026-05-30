import {
  ATTACHMENT_MAX_COUNT,
  PROVIDER_UPLOAD_CAPABILITIES,
  type AttachmentRef,
  type Provider,
} from '../runtime/protocol';

export type AttachmentCapabilityResult =
  | { ok: true }
  | { ok: false; reason: string };

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

  return { ok: true };
}
