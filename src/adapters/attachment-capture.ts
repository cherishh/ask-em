import type { CapturedAttachment } from '../runtime/protocol';
import { getAttachmentExtension } from '../runtime/protocol';
import type {
  AttachmentSubmitResolution,
  ComposerAttachmentSnapshot,
} from './types';

type AttachmentSource = CapturedAttachment['source'];

const DUPLICATE_CAPTURE_WINDOW_MS = 1_000;

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
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'pptx',
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
  return extension
    ? (MIME_BY_EXTENSION[extension] ?? 'application/octet-stream')
    : 'application/octet-stream';
}

function normalizeName(
  file: File,
  source: AttachmentSource,
  index: number,
): string {
  const explicitName = file.name.trim();
  if (explicitName) {
    return explicitName;
  }

  const extension = EXTENSION_BY_MIME[file.type.trim().toLowerCase()] ?? 'bin';
  return `${source}-${index + 1}.${extension}`;
}

function getFileCaptureKey(file: File): string {
  const lastModified =
    typeof file.lastModified === 'number' ? file.lastModified : 0;
  return [
    file.name.trim().toLowerCase(),
    file.type.trim().toLowerCase(),
    file.size,
    lastModified,
  ].join('\u0000');
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

export function getFilesFromFileList(
  files: FileList | File[] | null | undefined,
): File[] {
  return Array.from(files ?? []).filter(isFileLike);
}

export function getFilesFromDataTransfer(
  dataTransfer: DataTransfer | null | undefined,
): File[] {
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

export function getPlainTextFromDataTransfer(
  dataTransfer: DataTransfer | null | undefined,
): string {
  if (!dataTransfer || typeof dataTransfer.getData !== 'function') {
    return '';
  }

  try {
    return dataTransfer.getData('text/plain') ?? '';
  } catch {
    return '';
  }
}

function compactAttachmentText(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

function hasDuplicateCapturedAttachmentNames(
  attachments: CapturedAttachment[],
): boolean {
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

  // The snapshot item is DOM text that may wrap the filename in noise ("report.png
  // 2 MB Remove"), so we substring-match the filename inside it. But a shorter
  // filename can be a coincidental substring of a different one ("port.png" inside
  // "report.png"), so prefer an exact match, then fall back to the LONGEST (most
  // specific) substring match rather than the first one encountered.
  let best: {
    index: number;
    attachment: CapturedAttachment;
    length: number;
  } | null = null;
  for (let index = 0; index < attachments.length; index += 1) {
    if (usedIndexes.has(index)) {
      continue;
    }

    const compactName = compactAttachmentText(attachments[index].name);
    if (!compactName) {
      continue;
    }

    if (compactName === compactItem) {
      return { index, attachment: attachments[index] };
    }

    if (
      compactItem.includes(compactName) &&
      (!best || compactName.length > best.length)
    ) {
      best = {
        index,
        attachment: attachments[index],
        length: compactName.length,
      };
    }
  }

  return best ? { index: best.index, attachment: best.attachment } : null;
}

export class ComposerAttachmentCaptureBuffer {
  private attachments: CapturedAttachment[] = [];
  private recentCaptureAtByFileKey = new Map<string, number>();
  private pastedTextCaptureCount = 0;

  addFiles(files: File[], source: AttachmentSource): CapturedAttachment[] {
    if (files.length === 0) {
      return [];
    }

    const now = Date.now();
    for (const [key, capturedAt] of this.recentCaptureAtByFileKey) {
      if (now - capturedAt > DUPLICATE_CAPTURE_WINDOW_MS) {
        this.recentCaptureAtByFileKey.delete(key);
      }
    }

    const recentlyCapturedKeys = new Set(this.recentCaptureAtByFileKey.keys());
    const filesToAdd = files.filter((file) => {
      return !recentlyCapturedKeys.has(getFileCaptureKey(file));
    });
    if (filesToAdd.length === 0) {
      return [];
    }

    const captured = normalizeCapturedFiles(filesToAdd, source);
    for (const file of filesToAdd) {
      this.recentCaptureAtByFileKey.set(getFileCaptureKey(file), now);
    }

    this.attachments = [...this.attachments, ...captured];
    return captured;
  }

  addPastedText(text: string, minChars: number): CapturedAttachment[] {
    if (text.trim().length < minChars) {
      return [];
    }

    this.pastedTextCaptureCount += 1;
    // Some providers turn very long pasted text into their own transient file.
    // Capture the original text here, then submit-time DOM snapshots still
    // decide whether that provider-side attachment is currently present.
    const file = new File(
      [text],
      `pasted-text-${this.pastedTextCaptureCount}.txt`,
      {
        type: 'text/plain',
        lastModified: Date.now(),
      },
    );

    return this.addFiles([file], 'pasted-text');
  }

  getAttachmentsForSubmit(): CapturedAttachment[] {
    return [...this.attachments];
  }

  resolveAttachmentsForSubmit(
    snapshot: ComposerAttachmentSnapshot | null,
  ): AttachmentSubmitResolution {
    const captured = this.getAttachmentsForSubmit();
    if (captured.length === 0) {
      // Providers can restore attachment cards from a persisted draft after a
      // reload; those files never fire capture events (and their bytes are gone),
      // but the DOM still shows them. Surface that count so the submit pipeline
      // can warn instead of silently fanning out text-only.
      const snapshotItems = (snapshot?.items ?? [])
        .map((item) => item.trim())
        .filter(Boolean);
      const currentCount = snapshot
        ? Math.max(0, snapshot.count, snapshotItems.length)
        : 0;

      return {
        attachments: [],
        capturedCount: 0,
        currentCount,
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

    const snapshotItems = (snapshot.items ?? [])
      .map((item) => item.trim())
      .filter(Boolean);
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

    if (
      hasDuplicateCapturedAttachmentNames(captured) &&
      currentCount !== captured.length
    ) {
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
        const match = findCapturedAttachmentForSnapshotItem(
          captured,
          usedIndexes,
          item,
        );
        if (!match) {
          continue;
        }

        usedIndexes.add(match.index);
        matchedAttachments.push(match.attachment);
      }

      const missingCount = currentCount - matchedAttachments.length;
      if (missingCount > 0) {
        const pastedTextMatches = captured
          .map((attachment, index) => ({ attachment, index }))
          .filter(
            ({ attachment, index }) =>
              attachment.source === 'pasted-text' && !usedIndexes.has(index),
          )
          .slice(0, missingCount);

        if (pastedTextMatches.length === missingCount) {
          matchedAttachments.push(
            ...pastedTextMatches.map(({ attachment }) => attachment),
          );
        }
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
    this.recentCaptureAtByFileKey.clear();
    this.pastedTextCaptureCount = 0;
  }
}
