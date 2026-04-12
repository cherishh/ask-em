import type { Provider } from '../runtime/protocol';

export interface SiteInfo {
  name: Provider;
  origin: string;
  matches: string[];
  isBlankChatUrl(url: string): boolean;
  extractSessionId(url: string): string | null;
}

export const SUPPORTED_SITES: SiteInfo[] = [
  {
    name: 'claude',
    origin: 'https://claude.ai',
    matches: ['*://claude.ai/*'],
    isBlankChatUrl(url) {
      const pathname = new URL(url).pathname;
      return pathname === '/' || pathname.startsWith('/new');
    },
    extractSessionId(url) {
      return extractLastPathSegment(url, '/chat/');
    },
  },
  {
    name: 'chatgpt',
    origin: 'https://chatgpt.com',
    matches: ['*://chatgpt.com/*'],
    isBlankChatUrl(url) {
      const pathname = new URL(url).pathname;
      return pathname === '/' || pathname === '/c';
    },
    extractSessionId(url) {
      return extractLastPathSegment(url, '/c/');
    },
  },
  {
    name: 'gemini',
    origin: 'https://gemini.google.com',
    matches: ['*://gemini.google.com/*'],
    isBlankChatUrl(url) {
      return new URL(url).pathname === '/app';
    },
    extractSessionId(url) {
      return extractLastPathSegment(url, '/app/');
    },
  },
  {
    name: 'deepseek',
    origin: 'https://chat.deepseek.com',
    matches: ['*://chat.deepseek.com/*'],
    isBlankChatUrl(url) {
      const pathname = new URL(url).pathname;
      return pathname === '/' || pathname.startsWith('/new');
    },
    extractSessionId(url) {
      return extractLastPathSegment(url, '/a/chat/s/');
    },
  },
  {
    name: 'manus',
    origin: 'https://manus.im',
    matches: ['*://manus.im/*'],
    isBlankChatUrl(url) {
      const pathname = new URL(url).pathname;
      return pathname === '/app' || pathname === '/app/';
    },
    extractSessionId(url) {
      return extractLastPathSegment(url, '/app/');
    },
  },
];

function extractLastPathSegment(url: string, prefix: string): string | null {
  try {
    const pathname = new URL(url).pathname;

    if (!pathname.startsWith(prefix)) {
      return null;
    }

    const value = pathname.slice(prefix.length).split('/')[0];
    return value || null;
  } catch {
    return null;
  }
}

export function getSiteInfo(url: string): SiteInfo | null {
  try {
    const origin = new URL(url).origin;
    return SUPPORTED_SITES.find((site) => site.origin === origin) ?? null;
  } catch {
    return null;
  }
}

export function getSiteInfoByProvider(provider: Provider): SiteInfo {
  const siteInfo = SUPPORTED_SITES.find((site) => site.name === provider);

  if (!siteInfo) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  return siteInfo;
}

export function isSupportedOrigin(url: string): boolean {
  return getSiteInfo(url) !== null;
}
