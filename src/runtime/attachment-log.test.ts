import { describe, expect, it } from 'vitest';
import { formatAttachmentSummary, shortAttachmentId, shortSubmitId } from './attachment-log';

describe('attachment log formatting', () => {
  it('summarizes attachments with filenames but without bytes payloads', () => {
    const refWithName = {
      id: 'abcdef123456',
      mime: 'application/pdf',
      size: 12,
      source: 'paste',
      name: 'private-report.pdf',
    };
    const summary = formatAttachmentSummary([refWithName]);

    expect(summary).toBe('1 attachment(s) [abcdef12:private-report.pdf:application/pdf:12b:paste]');
    expect(summary).toContain('private-report.pdf');
    expect(summary).not.toContain('base64');
    expect(summary).not.toContain('data:');
  });

  it('shortens ids consistently', () => {
    expect(shortAttachmentId('attachment-1234')).toBe('attachme');
    expect(shortSubmitId('submit-1234')).toBe('submit-1');
  });
});
