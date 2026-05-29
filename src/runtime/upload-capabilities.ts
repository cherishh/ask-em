import type { Provider, UploadCapability } from './types';

export const GENERIC_ATTACHMENT_MIMES = new Set([
  '',
  'application/octet-stream',
  'binary/octet-stream',
]);

export const COMMON_ATTACHMENT_MIMES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

export const COMMON_ATTACHMENT_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'pdf',
  'doc',
  'docx',
  'txt',
  'md',
  'csv',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
];

export const PROVIDER_UPLOAD_CAPABILITIES: Record<Provider, UploadCapability> = {
  claude: {
    mimes: COMMON_ATTACHMENT_MIMES,
    extensions: COMMON_ATTACHMENT_EXTENSIONS,
    maxFiles: 20,
  },
  chatgpt: {
    mimes: COMMON_ATTACHMENT_MIMES,
    extensions: COMMON_ATTACHMENT_EXTENSIONS,
    maxFiles: 20,
  },
  gemini: {
    mimes: COMMON_ATTACHMENT_MIMES,
    extensions: COMMON_ATTACHMENT_EXTENSIONS,
    maxFiles: 10,
  },
  deepseek: {
    mimes: COMMON_ATTACHMENT_MIMES,
    extensions: COMMON_ATTACHMENT_EXTENSIONS,
    maxFiles: 10,
  },
  manus: {
    mimes: COMMON_ATTACHMENT_MIMES,
    extensions: COMMON_ATTACHMENT_EXTENSIONS,
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

export function isGenericAttachmentMime(mime: string): boolean {
  return GENERIC_ATTACHMENT_MIMES.has(mime.trim().toLowerCase());
}
