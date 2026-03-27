import { claudeAdapter } from './claude';
import { deepseekAdapter } from './deepseek';
import { geminiAdapter } from './gemini';
import { chatgptAdapter } from './chatgpt';
import type { SiteAdapter } from './types';
import { getSiteInfo, isSupportedOrigin, SUPPORTED_SITES } from './sites';

export const adapterRegistry: Record<(typeof SUPPORTED_SITES)[number]['name'], SiteAdapter> = {
  claude: claudeAdapter,
  chatgpt: chatgptAdapter,
  gemini: geminiAdapter,
  deepseek: deepseekAdapter,
};

export function getAdapter(provider: (typeof SUPPORTED_SITES)[number]['name']): SiteAdapter {
  return adapterRegistry[provider];
}

export function getAdapterForUrl(url: string): SiteAdapter | null {
  const siteInfo = getSiteInfo(url);
  return siteInfo ? adapterRegistry[siteInfo.name] : null;
}

export function isKnownProviderUrl(url: string): boolean {
  return isSupportedOrigin(url);
}
