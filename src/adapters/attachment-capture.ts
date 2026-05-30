import type { CapturedAttachment } from '../runtime/protocol';
import { getAttachmentExtension } from '../runtime/protocol';
import type {
  AttachmentSubmitResolution,
  ComposerAttachmentSnapshot,
} from './types';

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

function isFileLike(value: unknown): value is File {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<File>;
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.type === 'string' &&
    typeof candidate.size === 'number' &&
    typeof candidate.arrayBuffer === 'function'
  );
}

export function getFilesFromFileList(files: FileList | File[] | null | undefined): File[] {
  return Array.from(files ?? []).filter(isFileLike);
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
    .filter(isFileLike);
}

function compactAttachmentText(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

function hasDuplicateCapturedAttachmentNames(attachments: CapturedAttachment[]): boolean {
  const counts = new Map<string, number>();

  for (const attachment of attachments) {
    const compactName = compactAttachmentText(attachment.name);
    if (!compactName) {
      continue;
    }

    counts.set(compactName, (counts.get(compactName) ?? 0) + 1);
  }

  return Array.from(counts.values()).some((count) => count > 1);
}

function findCapturedAttachmentForSnapshotItem(
  attachments: CapturedAttachment[],
  usedIndexes: Set<number>,
  item: string,
): { index: number; attachment: CapturedAttachment } | null {
  const compactItem = compactAttachmentText(item);
  if (!compactItem) {
    return null;
  }

  for (let index = 0; index < attachments.length; index += 1) {
    if (usedIndexes.has(index)) {
      continue;
    }

    const compactName = compactAttachmentText(attachments[index].name);
    if (compactName && compactItem.includes(compactName)) {
      return {
        index,
        attachment: attachments[index],
      };
    }
  }

  return null;
}

export class ComposerAttachmentCaptureBuffer {
  private attachments: CapturedAttachment[] = [];

  addFiles(files: File[], source: AttachmentSource): CapturedAttachment[] {
    if (files.length === 0) {
      return [];
    }

    const captured = normalizeCapturedFiles(files, source);
    this.attachments = [...this.attachments, ...captured];
    return captured;
  }

  getAttachmentsForSubmit(): CapturedAttachment[] {
    return [...this.attachments];
  }

  resolveAttachmentsForSubmit(
    snapshot: ComposerAttachmentSnapshot | null,
  ): AttachmentSubmitResolution {
    const captured = this.getAttachmentsForSubmit();
    if (captured.length === 0) {
      return {
        attachments: [],
        capturedCount: 0,
        currentCount: 0,
        submittedCount: 0,
        reason: 'no-captured-attachments',
      };
    }

    if (!snapshot) {
      return {
        attachments: [],
        capturedCount: captured.length,
        currentCount: null,
        submittedCount: 0,
        reason: 'missing-source-snapshot',
      };
    }

    const snapshotItems = (snapshot.items ?? []).map((item) => item.trim()).filter(Boolean);
    const currentCount = Math.max(0, snapshot.count, snapshotItems.length);
    if (currentCount === 0) {
      return {
        attachments: [],
        capturedCount: captured.length,
        currentCount,
        submittedCount: 0,
        reason: 'no-current-attachments',
      };
    }

    if (hasDuplicateCapturedAttachmentNames(captured) && currentCount !== captured.length) {
      return {
        attachments: [],
        capturedCount: captured.length,
        currentCount,
        submittedCount: 0,
        reason: 'ambiguous-current-attachments',
      };
    }

    if (snapshotItems.length > 0) {
      const usedIndexes = new Set<number>();
      const matchedAttachments: CapturedAttachment[] = [];

      for (const item of snapshotItems) {
        const match = findCapturedAttachmentForSnapshotItem(captured, usedIndexes, item);
        if (!match) {
          continue;
        }

        usedIndexes.add(match.index);
        matchedAttachments.push(match.attachment);
      }

      if (matchedAttachments.length === currentCount) {
        return {
          attachments: matchedAttachments,
          capturedCount: captured.length,
          currentCount,
          submittedCount: matchedAttachments.length,
        };
      }

      return {
        attachments: [],
        capturedCount: captured.length,
        currentCount,
        submittedCount: 0,
        reason: 'unmatched-current-attachments',
      };
    }

    if (currentCount === captured.length) {
      return {
        attachments: captured,
        capturedCount: captured.length,
        currentCount,
        submittedCount: captured.length,
      };
    }

    return {
      attachments: [],
      capturedCount: captured.length,
      currentCount,
      submittedCount: 0,
      reason: 'ambiguous-current-attachments',
    };
  }

  clear() {
    this.attachments = [];
  }
}
