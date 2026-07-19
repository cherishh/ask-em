import { describe, expect, it } from 'vitest';
import { ALL_PROVIDERS, normalizePopupProviderOrder } from './protocol';

describe('popup provider order', () => {
  it('preserves a valid custom order', () => {
    expect(normalizePopupProviderOrder([
      'kimi',
      'claude',
      'chatgpt',
      'gemini',
      'grok',
      'deepseek',
      'manus',
    ])).toEqual([
      'kimi',
      'claude',
      'chatgpt',
      'gemini',
      'grok',
      'deepseek',
      'manus',
    ]);
  });

  it('deduplicates stored values and appends missing providers', () => {
    expect(normalizePopupProviderOrder(['deepseek', 'claude', 'deepseek'])).toEqual([
      'deepseek',
      'claude',
      ...ALL_PROVIDERS.filter((provider) => !['deepseek', 'claude'].includes(provider)),
    ]);
  });
});
