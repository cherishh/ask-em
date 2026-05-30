// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  fileInputAcceptsAttachments,
  preferFileInputForAttachmentCount,
} from './file-input';

describe('file input helpers', () => {
  it('matches accept tokens by extension, MIME, and MIME wildcard', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,application/pdf,image/*';

    expect(fileInputAcceptsAttachments(input, [
      { id: 'a1', name: 'notes.md', mime: 'text/markdown', size: 1 },
      { id: 'a2', name: 'report.bin', mime: 'application/pdf', size: 1 },
      { id: 'a3', name: 'photo.jpeg', mime: 'image/jpeg', size: 1 },
    ])).toBe(true);
  });

  it('rejects an attachment batch when any file is outside accept', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf';

    expect(fileInputAcceptsAttachments(input, [
      { id: 'a1', name: 'report.pdf', mime: 'application/pdf', size: 1 },
      { id: 'a2', name: 'notes.md', mime: 'text/markdown', size: 1 },
    ])).toBe(false);
  });

  it('prefers a multiple input for multi-file batches', () => {
    const single = document.createElement('input');
    const multiple = document.createElement('input');
    single.type = 'file';
    multiple.type = 'file';
    multiple.multiple = true;

    expect(preferFileInputForAttachmentCount([single, multiple], 2)).toBe(multiple);
    expect(preferFileInputForAttachmentCount([single, multiple], 1)).toBe(single);
  });
});
