import type { Provider, UploadCapability } from './types';

export const GENERIC_ATTACHMENT_MIMES = new Set([
  '',
  'application/octet-stream',
  'binary/octet-stream',
]);

export const IMAGE_ATTACHMENT_MIME_PREFIX = 'image/';

export const DOCUMENT_ATTACHMENT_MIMES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

export const DOCUMENT_ATTACHMENT_EXTENSIONS = [
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
];

export const TEXT_ATTACHMENT_MIMES = [
  'application/javascript',
  'application/json',
  'application/ld+json',
  'application/sql',
  'application/toml',
  'application/typescript',
  'application/x-httpd-php',
  'application/x-javascript',
  'application/x-ndjson',
  'application/x-sh',
  'application/x-yaml',
  'application/xml',
  'image/svg+xml',
  'text/cache-manifest',
  'text/calendar',
  'text/css',
  'text/csv',
  'text/html',
  'text/javascript',
  'text/jsx',
  'text/markdown',
  'text/plain',
  'text/tab-separated-values',
  'text/tsx',
  'text/typescript',
  'text/xml',
  'text/yaml',
];

export const TEXT_ATTACHMENT_EXTENSIONS = [
  'astro',
  'bat',
  'bash',
  'c',
  'cc',
  'cfg',
  'conf',
  'cpp',
  'cs',
  'css',
  'csv',
  'env',
  'fish',
  'go',
  'h',
  'hpp',
  'htm',
  'html',
  'ini',
  'java',
  'js',
  'json',
  'jsonl',
  'jsx',
  'kotlin',
  'kt',
  'kts',
  'less',
  'log',
  'lua',
  'mjs',
  'md',
  'mdx',
  'php',
  'properties',
  'ps1',
  'py',
  'rb',
  'rs',
  'sass',
  'scala',
  'scss',
  'sh',
  'sql',
  'svelte',
  'svg',
  'toml',
  'ts',
  'tsv',
  'tsx',
  'txt',
  'vue',
  'xml',
  'yaml',
  'yml',
  'zsh',
];

export const BLOCKED_ATTACHMENT_MIME_PREFIXES = [
  'audio/',
  'font/',
  'video/',
];

export const BLOCKED_ATTACHMENT_MIMES = [
  'application/gzip',
  'application/java-archive',
  'application/vnd.android.package-archive',
  'application/vnd.apple.installer+xml',
  'application/vnd.microsoft.portable-executable',
  'application/x-7z-compressed',
  'application/x-apple-diskimage',
  'application/x-bzip',
  'application/x-bzip2',
  'application/x-chrome-extension',
  'application/x-cpio',
  'application/x-dosexec',
  'application/x-gtar',
  'application/x-msdownload',
  'application/x-msi',
  'application/x-rar-compressed',
  'application/x-shockwave-flash',
  'application/x-tar',
  'application/x-xz',
  'application/zip',
  'application/zstd',
];

export const BLOCKED_ATTACHMENT_EXTENSIONS = [
  '7z',
  'a',
  'apk',
  'app',
  'avi',
  'bin',
  'bz2',
  'class',
  'deb',
  'dll',
  'dmg',
  'dylib',
  'ear',
  'eot',
  'exe',
  'flac',
  'gz',
  'hevc',
  'ipa',
  'iso',
  'jar',
  'm4a',
  'm4v',
  'mkv',
  'mov',
  'mp3',
  'mp4',
  'mpeg',
  'mpg',
  'msi',
  'o',
  'ogg',
  'otf',
  'pkg',
  'rar',
  'rpm',
  'so',
  'tar',
  'tgz',
  'ttf',
  'war',
  'wasm',
  'wav',
  'webm',
  'woff',
  'woff2',
  'xz',
  'zip',
  'zst',
];

const COMMON_UPLOAD_CAPABILITY = {
  allowImages: true,
  allowPlainText: true,
  documentMimes: DOCUMENT_ATTACHMENT_MIMES,
  documentExtensions: DOCUMENT_ATTACHMENT_EXTENSIONS,
  blockedMimes: BLOCKED_ATTACHMENT_MIMES,
  blockedMimePrefixes: BLOCKED_ATTACHMENT_MIME_PREFIXES,
  blockedExtensions: BLOCKED_ATTACHMENT_EXTENSIONS,
} satisfies Omit<Exclude<UploadCapability, null>, 'maxFiles'>;

export const PROVIDER_UPLOAD_CAPABILITIES: Record<Provider, UploadCapability> = {
  claude: {
    ...COMMON_UPLOAD_CAPABILITY,
    maxFiles: 20,
  },
  chatgpt: {
    ...COMMON_UPLOAD_CAPABILITY,
    maxFiles: 20,
  },
  gemini: {
    ...COMMON_UPLOAD_CAPABILITY,
    maxFiles: 10,
  },
  deepseek: {
    ...COMMON_UPLOAD_CAPABILITY,
    maxFiles: 10,
  },
  manus: {
    ...COMMON_UPLOAD_CAPABILITY,
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

export function isTextAttachmentMime(mime: string): boolean {
  const normalized = mime.trim().toLowerCase();
  return normalized.startsWith('text/') || TEXT_ATTACHMENT_MIMES.includes(normalized);
}

export function isTextAttachmentExtension(extension: string | null): boolean {
  return Boolean(extension && TEXT_ATTACHMENT_EXTENSIONS.includes(extension));
}
