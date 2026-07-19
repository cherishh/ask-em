import { claudeAdapter } from './claude';
import { deepseekAdapter } from './deepseek';
import { geminiAdapter } from './gemini';
import { chatgptAdapter } from './chatgpt';
import { manusAdapter } from './manus';
import { grokAdapter } from './grok';
import { kimiAdapter } from './kimi';
import type { ProviderAdapter } from './types';
import { getSiteInfo, isSupportedOrigin, SUPPORTED_SITES } from './sites';

export const adapterRegistry: Record<(typeof SUPPORTED_SITES)[number]['name'], ProviderAdapter> = {
  claude: claudeAdapter,
  chatgpt: chatgptAdapter,
  gemini: geminiAdapter,
  kimi: kimiAdapter,
  deepseek: deepseekAdapter,
  manus: manusAdapter,
  grok: grokAdapter,
};

export function getAdapter(provider: (typeof SUPPORTED_SITES)[number]['name']): ProviderAdapter {
  return adapterRegistry[provider];
}

export function getAdapterForUrl(url: string): ProviderAdapter | null {
  const siteInfo = getSiteInfo(url);
  return siteInfo ? adapterRegistry[siteInfo.name] : null;
}

export function isKnownProviderUrl(url: string): boolean {
  return isSupportedOrigin(url);
}
