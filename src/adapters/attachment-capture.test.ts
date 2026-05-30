// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { ComposerAttachmentCaptureBuffer, getFilesFromDataTransfer, getFilesFromFileList } from './attachment-capture';

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
});

describe('attachment submit snapshot resolution', () => {
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
});
