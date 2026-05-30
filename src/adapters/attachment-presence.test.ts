import { describe, expect, it } from 'vitest';
import { countAttachmentPresenceDelta } from './attachment-presence';

describe('attachment presence helpers', () => {
  it('uses count delta when keys are unavailable', () => {
    expect(countAttachmentPresenceDelta({ count: 1 }, { count: 3 })).toBe(2);
  });

  it('uses unique new keys when counts are ambiguous', () => {
    expect(countAttachmentPresenceDelta(
      { count: 1, keys: ['old.pdf'] },
      { count: 1, keys: ['old.pdf', 'new.pdf'] },
    )).toBe(1);
  });

  it('keeps duplicate filename or aggregate-card cases conservative through count delta', () => {
    expect(countAttachmentPresenceDelta(
      { count: 0, keys: [] },
      { count: 2, keys: ['README.md'] },
    )).toBe(2);
  });
});
