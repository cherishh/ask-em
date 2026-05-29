import type { CapturedAttachment } from '../runtime/protocol';
import { getAttachmentExtension } from '../runtime/protocol';

type AttachmentSource = CapturedAttachment['source'];

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

function createAttachmentId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `attachment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

function normalizeMime(file: File, name: string): string {
  const explicitMime = file.type.trim();
  if (explicitMime) {
    return explicitMime;
  }

  const extension = getAttachmentExtension(name);
  return extension ? MIME_BY_EXTENSION[extension] ?? 'application/octet-stream' : 'application/octet-stream';
}

function normalizeName(file: File, source: AttachmentSource, index: number): string {
  const explicitName = file.name.trim();
  if (explicitName) {
    return explicitName;
  }

  const extension = EXTENSION_BY_MIME[file.type.trim().toLowerCase()] ?? 'bin';
  return `${source}-${index + 1}.${extension}`;
}

export function normalizeCapturedFiles(
  files: File[],
  source: AttachmentSource,
): CapturedAttachment[] {
  return files.map((file, index) => {
    const name = normalizeName(file, source, index);
    return {
      id: createAttachmentId(),
      file,
      name,
      mime: normalizeMime(file, name),
      size: file.size,
      source,
    };
  });
}

export function getFilesFromFileList(files: FileList | File[] | null | undefined): File[] {
  return Array.from(files ?? []).filter((file): file is File => file instanceof File);
}

export function getFilesFromDataTransfer(dataTransfer: DataTransfer | null | undefined): File[] {
  if (!dataTransfer) {
    return [];
  }

  const files = getFilesFromFileList(dataTransfer.files);
  if (files.length > 0) {
    return files;
  }

  return Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file instanceof File);
}

export class ComposerAttachmentCaptureBuffer {
  private attachments: CapturedAttachment[] = [];
  private invalidatedForCurrentMessage = false;

  addFiles(files: File[], source: AttachmentSource): CapturedAttachment[] {
    if (files.length === 0) {
      return [];
    }

    if (this.invalidatedForCurrentMessage) {
      this.attachments = [];
      this.invalidatedForCurrentMessage = false;
    }

    const captured = normalizeCapturedFiles(files, source);
    this.attachments = [...this.attachments, ...captured];
    return captured;
  }

  getAttachmentsForSubmit(): CapturedAttachment[] {
    return this.invalidatedForCurrentMessage ? [] : [...this.attachments];
  }

  clear() {
    this.attachments = [];
    this.invalidatedForCurrentMessage = false;
  }

  invalidateCurrentMessage() {
    this.attachments = [];
    this.invalidatedForCurrentMessage = true;
  }
}
