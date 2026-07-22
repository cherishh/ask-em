import { describe, expect, it } from 'vitest';
import { getSiteInfo, getSiteInfoByProvider } from './sites';

describe('chatgpt site info', () => {
  it('keeps provisional WEB sessions on the new-chat surface', () => {
    const site = getSiteInfoByProvider('chatgpt');
    const provisionalUrl = 'https://chatgpt.com/c/WEB:3ab326f6-2910-4b5c-9aaf-c92e5378dcc4';

    expect(site.isBlankChatUrl('https://chatgpt.com/')).toBe(true);
    expect(site.isBlankChatUrl(provisionalUrl)).toBe(true);
    expect(site.extractSessionId(provisionalUrl)).toBeNull();
  });

  it('extracts the canonical session after ChatGPT replaces a WEB session', () => {
    const site = getSiteInfoByProvider('chatgpt');
    const canonicalUrl = 'https://chatgpt.com/c/6a60a013-01c0-83ea-9467-12ba48807020';

    expect(site.isBlankChatUrl(canonicalUrl)).toBe(false);
    expect(site.extractSessionId(canonicalUrl)).toBe('6a60a013-01c0-83ea-9467-12ba48807020');
    expect(getSiteInfo(canonicalUrl)?.name).toBe('chatgpt');
  });
});

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

describe('grok site info', () => {
  it('distinguishes blank chat routes from conversation routes', () => {
    const site = getSiteInfoByProvider('grok');

    expect(site.isBlankChatUrl('https://grok.com/')).toBe(true);
    expect(site.isBlankChatUrl('https://grok.com/c')).toBe(true);
    expect(site.isBlankChatUrl('https://grok.com/c/')).toBe(true);
    expect(site.isBlankChatUrl('https://grok.com/c/conversation-id')).toBe(false);
  });

  it('extracts conversation ids and recognizes the Grok origin', () => {
    const site = getSiteInfoByProvider('grok');

    expect(site.extractSessionId('https://grok.com/c/conversation-id?rid=request-id')).toBe(
      'conversation-id',
    );
    expect(site.extractSessionId('https://grok.com/c')).toBeNull();
    expect(getSiteInfo('https://grok.com/')?.name).toBe('grok');
  });
});

describe('kimi site info', () => {
  it('distinguishes blank chat routes from conversation routes', () => {
    const site = getSiteInfoByProvider('kimi');

    expect(site.isBlankChatUrl('https://www.kimi.com/')).toBe(true);
    expect(site.isBlankChatUrl('https://www.kimi.com/chat')).toBe(true);
    expect(site.isBlankChatUrl('https://www.kimi.com/chat/conversation-id')).toBe(false);
  });

  it('extracts conversation ids without treating history as a session', () => {
    const site = getSiteInfoByProvider('kimi');

    expect(site.extractSessionId('https://www.kimi.com/chat/conversation-id?chat_enter_method=history')).toBe(
      'conversation-id',
    );
    expect(site.extractSessionId('https://www.kimi.com/chat/history')).toBeNull();
    expect(getSiteInfo('https://www.kimi.com/')?.name).toBe('kimi');
  });
});
