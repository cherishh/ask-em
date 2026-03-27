import type { Provider } from './types';

export interface SiteInfo {
  name: Provider;
  url: string;
}

export const SUPPORTED_SITES: SiteInfo[] = [
  { name: 'claude', url: 'https://claude.ai' },
  { name: 'chatgpt', url: 'https://chatgpt.com' },
  { name: 'gemini', url: 'https://gemini.google.com' },
  { name: 'deepseek', url: 'https://chat.deepseek.com' },
];
