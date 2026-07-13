import type { Provider, UploadCapability } from './types';

export const PROVIDER_UPLOAD_CAPABILITIES: Record<Provider, UploadCapability> = {
  claude: {
    maxFiles: 20,
  },
  chatgpt: {
    maxFiles: 20,
  },
  gemini: {
    maxFiles: 10,
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

export function getAttachmentExtension(name: string): string | null {
  const lastSegment = name.trim().split(/[\\/]/).at(-1) ?? '';
  const dotIndex = lastSegment.lastIndexOf('.');

  if (dotIndex <= 0 || dotIndex === lastSegment.length - 1) {
    return null;
  }

  return lastSegment.slice(dotIndex + 1).toLowerCase();
}
