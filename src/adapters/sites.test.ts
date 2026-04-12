import { describe, expect, it } from 'vitest';
import { getSiteInfo, getSiteInfoByProvider } from './sites';

describe('manus site info', () => {
  it('treats /app as a blank chat url', () => {
    const site = getSiteInfoByProvider('manus');

    expect(site.isBlankChatUrl('https://manus.im/')).toBe(true);
    expect(site.isBlankChatUrl('https://manus.im/app')).toBe(true);
    expect(site.isBlankChatUrl('https://manus.im/app/')).toBe(true);
    expect(site.isBlankChatUrl('https://manus.im/app/WtMh6KGvNUEHcW7ctGo2Ko')).toBe(false);
  });

  it('extracts a session id from /app/:id urls', () => {
    const site = getSiteInfoByProvider('manus');

    expect(site.extractSessionId('https://manus.im/app/WtMh6KGvNUEHcW7ctGo2Ko')).toBe(
      'WtMh6KGvNUEHcW7ctGo2Ko',
    );
    expect(site.extractSessionId('https://manus.im/app')).toBeNull();
  });

  it('recognizes manus origins', () => {
    expect(getSiteInfo('https://manus.im/app')?.name).toBe('manus');
  });
});
