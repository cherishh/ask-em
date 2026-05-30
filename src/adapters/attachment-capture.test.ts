// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  ComposerAttachmentCaptureBuffer,
  getFilesFromDataTransfer,
  getFilesFromFileList,
  getPlainTextFromDataTransfer,
} from './attachment-capture';

const PASTED_TEXT_ATTACHMENT_MIN_CHARS = 5_000;

function createCrossRealmFileLike(name: string): File {
  return {
    name,
    type: 'application/pdf',
    size: 3,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  } as File;
}

describe('attachment capture file extraction', () => {
  it('accepts File-like objects that fail instanceof File across realms', () => {
    const file = createCrossRealmFileLike('cross-realm.pdf');

    expect(file instanceof File).toBe(false);
    expect(getFilesFromFileList([file])).toEqual([file]);
  });

  it('accepts File-like objects returned from data transfer items', () => {
    const file = createCrossRealmFileLike('drop.pdf');
    const dataTransfer = {
      files: [],
      items: [
        {
          kind: 'file',
          getAsFile: () => file,
        },
      ],
    } as unknown as DataTransfer;

    expect(getFilesFromDataTransfer(dataTransfer)).toEqual([file]);
  });

  it('reads plain text from clipboard data safely', () => {
    const dataTransfer = {
      getData: (type: string) => type === 'text/plain' ? 'hello' : '',
    } as DataTransfer;

    expect(getPlainTextFromDataTransfer(dataTransfer)).toBe('hello');
  });
});

describe('attachment submit snapshot resolution', () => {
  it('deduplicates the same file reported by overlapping capture events', () => {
    const buffer = new ComposerAttachmentCaptureBuffer();
    const first = new File(['a'], 'report.pdf', {
      type: 'application/pdf',
      lastModified: 123,
    });
    const duplicate = new File(['a'], 'report.pdf', {
      type: 'application/pdf',
      lastModified: 123,
    });

    expect(buffer.addFiles([first], 'transient-file-input')).toHaveLength(1);
    expect(buffer.addFiles([duplicate], 'file-input')).toHaveLength(0);
    expect(buffer.resolveAttachmentsForSubmit({
      count: 1,
      items: ['report.pdf'],
    })).toMatchObject({
      capturedCount: 1,
      currentCount: 1,
      submittedCount: 1,
    });
  });

  it('keeps duplicate file entries from the same capture event', () => {
    const buffer = new ComposerAttachmentCaptureBuffer();
    const first = new File(['a'], 'report.pdf', {
      type: 'application/pdf',
      lastModified: 123,
    });
    const second = new File(['a'], 'report.pdf', {
      type: 'application/pdf',
      lastModified: 123,
    });

    expect(buffer.addFiles([first, second], 'file-input')).toHaveLength(2);
    expect(buffer.resolveAttachmentsForSubmit({
      count: 2,
      items: ['report.pdf', 'report.pdf'],
    })).toMatchObject({
      capturedCount: 2,
      currentCount: 2,
      submittedCount: 2,
    });
  });

  it('fails closed when duplicate captured filenames become ambiguous at submit time', () => {
    const buffer = new ComposerAttachmentCaptureBuffer();
    buffer.addFiles([
      new File(['a'], 'report.pdf', { type: 'application/pdf' }),
      new File(['b'], 'report.pdf', { type: 'application/pdf' }),
    ], 'file-input');

    expect(buffer.resolveAttachmentsForSubmit({
      count: 1,
      items: ['report.pdf'],
    })).toMatchObject({
      attachments: [],
      capturedCount: 2,
      currentCount: 1,
      submittedCount: 0,
      reason: 'ambiguous-current-attachments',
    });
  });

  it('allows duplicate filenames when the submit-time snapshot still shows all copies', () => {
    const buffer = new ComposerAttachmentCaptureBuffer();
    buffer.addFiles([
      new File(['a'], 'report.pdf', { type: 'application/pdf' }),
      new File(['b'], 'report.pdf', { type: 'application/pdf' }),
    ], 'file-input');

    expect(buffer.resolveAttachmentsForSubmit({
      count: 2,
      items: ['report.pdf', 'report.pdf'],
    })).toMatchObject({
      capturedCount: 2,
      currentCount: 2,
      submittedCount: 2,
    });
  });

  it('captures long pasted text as a synthetic text attachment', async () => {
    const buffer = new ComposerAttachmentCaptureBuffer();
    const text = 'x'.repeat(PASTED_TEXT_ATTACHMENT_MIN_CHARS);

    const captured = buffer.addPastedText(text, PASTED_TEXT_ATTACHMENT_MIN_CHARS);

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      name: 'pasted-text-1.txt',
      mime: 'text/plain',
      size: PASTED_TEXT_ATTACHMENT_MIN_CHARS,
      source: 'pasted-text',
    });
    await expect(captured[0].file.text()).resolves.toBe(text);
  });

  it('ignores short pasted text so normal paste stays plain text only', () => {
    const buffer = new ComposerAttachmentCaptureBuffer();

    expect(buffer.addPastedText(
      'x'.repeat(PASTED_TEXT_ATTACHMENT_MIN_CHARS - 1),
      PASTED_TEXT_ATTACHMENT_MIN_CHARS,
    )).toEqual([]);
    expect(buffer.getAttachmentsForSubmit()).toEqual([]);
  });

  it('matches provider-generated pasted-text attachment labels by count', () => {
    const buffer = new ComposerAttachmentCaptureBuffer();
    buffer.addPastedText('x'.repeat(PASTED_TEXT_ATTACHMENT_MIN_CHARS), PASTED_TEXT_ATTACHMENT_MIN_CHARS);

    expect(buffer.resolveAttachmentsForSubmit({
      count: 1,
      items: ['Pasted text'],
    })).toMatchObject({
      capturedCount: 1,
      currentCount: 1,
      submittedCount: 1,
    });
  });
});
