export type Provider = 'claude' | 'chatgpt' | 'gemini' | 'deepseek';

export interface ConversationRef {
  provider: Provider;
  sessionId: string | null;
  url: string;
}

export interface SiteAdapter {
  name: Provider;
  getCurrentUrl(): string;
  extractSessionId(url: string): string | null;
  isBlankChatUrl(url: string): boolean;
  detectPageState(): 'ready' | 'login-required' | 'not-ready';
}
