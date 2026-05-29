import { getVisibleButtonTexts } from './dom';
import { createDomProviderAdapter } from './factory';
import { readAttachmentFiles, setFileInputFiles } from './attachment-delivery';
import { PROVIDER_UPLOAD_CAPABILITIES } from '../runtime/protocol';

export function isClaudeLoginRequiredPage(input: {
  pathname: string;
  buttonTexts: string[];
}): boolean {
  const pathname = input.pathname.toLowerCase();
  if (pathname.startsWith('/login')) {
    return true;
  }

  const buttonTexts = input.buttonTexts.map((text) => text.toLowerCase());

  return (
    buttonTexts.some((text) => text.includes('continue with google')) ||
    buttonTexts.some((text) => text.includes('continue with email')) ||
    buttonTexts.some((text) => text === 'console login') ||
    buttonTexts.some((text) => text === 'log in')
  );
}

export const claudeAdapter = createDomProviderAdapter({
  provider: 'claude',
  uploadCapability: PROVIDER_UPLOAD_CAPABILITIES.claude,
  mountId: 'ask-em-claude-ui',
  className: 'ask-em-provider-ui ask-em-provider-ui-claude',
  classifyAuth() {
    const pathname = window.location.pathname;
    const buttonTexts = getVisibleButtonTexts();
    const isLoginRequired = isClaudeLoginRequiredPage({ pathname, buttonTexts });

    return {
      isLoginRequired,
      rule: pathname.toLowerCase().startsWith('/login')
        ? 'claude-auth-url'
        : isLoginRequired
          ? 'claude-auth-cta-cluster'
          : undefined,
      signals: `pathname=${pathname}; buttons=[${buttonTexts.slice(0, 6).join(' | ')}]`,
    };
  },
  composerSelectors: ['[data-testid="chat-input"]', '[aria-label="Write your prompt to Claude"]'],
  sendButtonSelectors: ['button[aria-label="Send message"]'],
  errorKeywords: ['conversation not found', 'something went wrong'],
  async setComposerPayload(payload, context) {
    await context.setComposerText(payload.text);

    if (payload.attachments.length === 0) {
      return;
    }

    const composer = context.findComposer();
    const form = composer?.closest('form') ?? composer?.parentElement?.parentElement ?? document;
    const fileInput =
      form.querySelector<HTMLInputElement>('input[type="file"]') ??
      document.querySelector<HTMLInputElement>('input[type="file"]');

    if (!fileInput) {
      throw new Error('upload failed');
    }

    setFileInputFiles(fileInput, await readAttachmentFiles(payload.attachments));
  },
  getComposerAttachmentPresence({ findComposer }) {
    const composer = findComposer();
    const container = composer?.closest('form') ?? composer?.parentElement?.parentElement ?? document;
    const removeButtons = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button[aria-label*="Remove"], button[aria-label*="remove"], [data-testid*="attachment"], [aria-label*="attachment"]',
      ),
    );
    const keys = removeButtons
      .map((element) => element.getAttribute('aria-label') ?? element.textContent ?? '')
      .map((value) => value.trim())
      .filter(Boolean);

    return {
      count: removeButtons.length,
      keys,
    };
  },
  detectAttachmentUploadError() {
    const text = document.body?.innerText?.toLowerCase() ?? '';
    return text.includes('upload failed') || text.includes('failed to upload') ? 'upload failed' : null;
  },
});
