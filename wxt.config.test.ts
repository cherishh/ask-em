import { describe, expect, it } from 'vitest';
import { createManifestFromEnv } from './wxt.config';

describe('wxt manifest permissions', () => {
  it('does not request tabs and keeps support hosts optional', () => {
    const manifest = createManifestFromEnv({
      WXT_SUPPORT_API_BASE_URL: 'https://support.example.com/support',
    });

    expect(manifest.permissions).toEqual(['storage']);
    expect(manifest).toMatchObject({
      host_permissions: expect.arrayContaining([
        'https://chatgpt.com/*',
        'https://claude.ai/*',
        'https://gemini.google.com/*',
        'https://www.kimi.com/*',
        'https://chat.deepseek.com/*',
        'https://manus.im/*',
        'https://grok.com/*',
      ]),
      optional_host_permissions: ['https://support.example.com/*'],
    });
  });
});
