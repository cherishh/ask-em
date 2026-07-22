import type { AttachmentRef, Provider, UploadCapability } from './types';

// Temporary product switch for Kimi image/file fan-out.
//
// Known issues while this is enabled:
// 1. A ready image or same-named file already present in the target composer can
//    make the attachment-presence delta stay at zero until delivery times out.
// 2. A restored attachment-only source draft has no captured bytes or prompt
//    text, so submit-controller returns before showing the skipped-sync warning.
export const KIMI_ATTACHMENT_FANOUT_ENABLED = false;

export const PROVIDER_UPLOAD_CAPABILITIES: Record<Provider, UploadCapability> =
  {
    claude: {
      maxFiles: 20,
    },
    chatgpt: {
      maxFiles: 20,
    },
    gemini: {
      maxFiles: 10,
    },
    kimi: {
      maxFiles: KIMI_ATTACHMENT_FANOUT_ENABLED ? 20 : 0,
    },
    deepseek: {
      maxFiles: 10,
    },
    manus: {
      // Manus free plan renders a multiple file input, but rejects batches with an upgrade modal.
      maxFiles: 1,
    },
    grok: {
      // Grok web accepts larger batches; ask'em's own transport caps a submit at 20 files.
      maxFiles: 20,
    },
  };

export function getProviderDeliveryAttachments<T extends AttachmentRef>(
  provider: Provider,
  attachments: T[],
): T[] {
  return PROVIDER_UPLOAD_CAPABILITIES[provider]?.maxFiles === 0
    ? []
    : attachments;
}

export function getAttachmentExtension(name: string): string | null {
  const lastSegment = name.trim().split(/[\\/]/).at(-1) ?? '';
  const dotIndex = lastSegment.lastIndexOf('.');

  if (dotIndex <= 0 || dotIndex === lastSegment.length - 1) {
    return null;
  }

  return lastSegment.slice(dotIndex + 1).toLowerCase();
}
