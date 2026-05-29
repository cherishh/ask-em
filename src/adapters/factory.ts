import type { DeliverPromptMessage, Provider, ProviderStatus, UploadCapability } from '../runtime/protocol';
import { isAskEmTransientFilesMessage } from '../runtime/protocol';
import {
  ComposerAttachmentCaptureBuffer,
  getFilesFromDataTransfer,
  getFilesFromFileList,
} from './attachment-capture';
import {
  detectObviousErrorPage,
  detectLoginRequired,
  dispatchEnterKey,
  getEditableText,
  isElementWithin,
  normalizeWhitespace,
  queryVisible,
  setEditableText,
  sleep,
  triggerPointerClick,
  waitFor,
  waitForUrlChange,
} from './dom';
import { getSiteInfoByProvider } from './sites';
import type { AdapterSnapshot, ProviderAdapter } from './types';

type DomProviderAdapterConfig = {
  provider: Provider;
  uploadCapability?: UploadCapability;
  mountId: string;
  className: string;
  prepareDom?: () => void;
  classifyAuth?: () => {
    isLoginRequired: boolean;
    rule?: string;
    signals?: string;
  };
  isLoginRequired?: () => boolean;
  composerSelectors: string[];
  sendButtonSelectors?: string[];
  findSendButton?: (findComposer: () => HTMLElement | null) => HTMLElement | null;
  loginKeywords?: string[];
  errorKeywords?: string[];
  submitWaitMs?: number;
  submitTimeoutMs?: number;
  isSendButtonEnabled?: (button: HTMLElement) => boolean;
  isFileInputForComposer?: (
    input: HTMLInputElement,
    context: {
      composer: HTMLElement | null;
      sendButton: HTMLElement | null;
    },
  ) => boolean;
};

export function createDomProviderAdapter(config: DomProviderAdapterConfig): ProviderAdapter {
  const site = getSiteInfoByProvider(config.provider);

  const prepareDom = () => {
    config.prepareDom?.();
  };
  const findComposer = () => {
    prepareDom();
    return queryVisible(config.composerSelectors);
  };
  const findSendButton = () => {
    prepareDom();
    return config.findSendButton ? config.findSendButton(findComposer) : queryVisible(config.sendButtonSelectors ?? []);
  };
  let suppressAttachmentCaptureUntil = 0;
  const isAttachmentCaptureSuppressed = () => Date.now() < suppressAttachmentCaptureUntil;
  const isSendButtonEnabled = (button: HTMLElement) =>
    config.isSendButtonEnabled ? config.isSendButtonEnabled(button) : !button.hasAttribute('disabled');
  const isFileInputForComposer = (input: HTMLInputElement) => {
    if (input.type !== 'file') {
      return false;
    }

    const composer = findComposer();
    const sendButton = findSendButton();
    if (config.isFileInputForComposer) {
      return config.isFileInputForComposer(input, { composer, sendButton });
    }

    const form = composer?.closest('form') ?? sendButton?.closest('form') ?? null;
    if (form && isElementWithin(input, form)) {
      return true;
    }

    const composerContainer = composer?.parentElement?.parentElement ?? composer?.parentElement ?? null;
    if (composerContainer && isElementWithin(input, composerContainer)) {
      return true;
    }

    const buttonContainer = sendButton?.parentElement?.parentElement ?? sendButton?.parentElement ?? null;
    return Boolean(buttonContainer && isElementWithin(input, buttonContainer));
  };
  const isLikelyAttachmentRemovalClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest<HTMLElement>('button, [role="button"], [aria-label]');
    if (!control) {
      return false;
    }

    const composer = findComposer();
    const container = composer?.closest('form') ?? composer?.parentElement?.parentElement ?? composer?.parentElement;
    if (container && !isElementWithin(control, container)) {
      return false;
    }

    const label = normalizeWhitespace(
      control.getAttribute('aria-label') ?? control.getAttribute('title') ?? control.textContent ?? '',
    ).toLowerCase();

    return (
      (label.includes('remove') || label.includes('delete') || label.includes('close')) &&
      (label.includes('attachment') || label.includes('file') || label.includes('image'))
    );
  };

  const getStatus = (): ProviderStatus => {
    prepareDom();
    const currentUrl = window.location.href;
    const authClassification = config.classifyAuth
      ? config.classifyAuth()
      : config.isLoginRequired
        ? { isLoginRequired: config.isLoginRequired() }
        : { isLoginRequired: detectLoginRequired(config.loginKeywords ?? []) };
    const isLoginRequired = authClassification.isLoginRequired;
    const hasObviousError = detectObviousErrorPage(config.errorKeywords ?? []);
    const isReady = Boolean(findComposer()) && !hasObviousError;
    const pageState = isLoginRequired ? 'login-required' : hasObviousError ? 'error' : isReady ? 'ready' : 'not-ready';

    return {
      provider: config.provider,
      currentUrl,
      sessionId: site.extractSessionId(currentUrl),
      pageKind: site.isBlankChatUrl(currentUrl) ? 'new-chat' : 'existing-session',
      pageState,
      authRule: isLoginRequired ? authClassification.rule : undefined,
      authSignalSummary: isLoginRequired ? authClassification.signals : undefined,
    };
  };

  const canDeliverPrompt = (message: DeliverPromptMessage, snapshot: AdapterSnapshot): boolean => {
    if (message.provider !== config.provider || snapshot.pageState !== 'ready') {
      return false;
    }

    if (message.expectedSessionId) {
      return snapshot.sessionId === message.expectedSessionId;
    }

    return snapshot.pageKind === 'new-chat';
  };

  return {
    name: config.provider,
    uploadCapability: config.uploadCapability,
    getUiSpec() {
      return {
        mountId: config.mountId,
        className: config.className,
      };
    },
    session: {
      getCurrentUrl() {
        return window.location.href;
      },
      getStatus,
      waitForSessionRefUpdate(baselineUrl) {
        return waitForUrlChange(site.extractSessionId, baselineUrl);
      },
      canDeliverPrompt,
    },
    composer: {
      subscribeToUserSubmissions(onSubmit) {
        const attachmentBuffer = new ComposerAttachmentCaptureBuffer();

        const handlePaste = (event: ClipboardEvent) => {
          if (isAttachmentCaptureSuppressed()) {
            return;
          }

          const composer = findComposer();
          if (!isElementWithin(event.target, composer)) {
            return;
          }

          attachmentBuffer.addFiles(getFilesFromDataTransfer(event.clipboardData), 'paste');
        };

        const handleDrop = (event: DragEvent) => {
          if (isAttachmentCaptureSuppressed()) {
            return;
          }

          const composer = findComposer();
          if (!isElementWithin(event.target, composer)) {
            return;
          }

          attachmentBuffer.addFiles(getFilesFromDataTransfer(event.dataTransfer), 'drop');
        };

        const handleFileInputChange = (event: Event) => {
          if (isAttachmentCaptureSuppressed()) {
            return;
          }

          const input = event.target instanceof HTMLInputElement ? event.target : null;
          if (!input || input.type !== 'file' || !isFileInputForComposer(input)) {
            return;
          }

          const files = getFilesFromFileList(input.files);
          if (files.length === 0) {
            attachmentBuffer.invalidateCurrentMessage();
            return;
          }

          attachmentBuffer.addFiles(files, 'file-input');
        };

        const handleTransientFilesMessage = (event: MessageEvent) => {
          if (event.source !== window || isAttachmentCaptureSuppressed()) {
            return;
          }

          if (!isAskEmTransientFilesMessage(event.data)) {
            return;
          }

          attachmentBuffer.addFiles(event.data.files, 'transient-file-input');
        };

        const handleKeydown = (event: KeyboardEvent) => {
          const composer = findComposer();
          if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.isComposing &&
            isElementWithin(event.target, composer)
          ) {
            onSubmit({
              text: getEditableText(composer),
              attachments: attachmentBuffer.getAttachmentsForSubmit(),
              onConsumed: () => attachmentBuffer.clear(),
            });
          }
        };

        const handleClick = (event: MouseEvent) => {
          if (isLikelyAttachmentRemovalClick(event)) {
            attachmentBuffer.invalidateCurrentMessage();
            return;
          }

          const sendButton = findSendButton();
          if (sendButton && isSendButtonEnabled(sendButton) && isElementWithin(event.target, sendButton)) {
            onSubmit({
              text: getEditableText(findComposer()),
              attachments: attachmentBuffer.getAttachmentsForSubmit(),
              onConsumed: () => attachmentBuffer.clear(),
            });
          }
        };

        document.addEventListener('paste', handlePaste, true);
        document.addEventListener('drop', handleDrop, true);
        document.addEventListener('change', handleFileInputChange, true);
        window.addEventListener('message', handleTransientFilesMessage);
        document.addEventListener('keydown', handleKeydown, true);
        document.addEventListener('click', handleClick, true);

        return () => {
          document.removeEventListener('paste', handlePaste, true);
          document.removeEventListener('drop', handleDrop, true);
          document.removeEventListener('change', handleFileInputChange, true);
          window.removeEventListener('message', handleTransientFilesMessage);
          document.removeEventListener('keydown', handleKeydown, true);
          document.removeEventListener('click', handleClick, true);
        };
      },
      async setComposerText(content) {
        prepareDom();
        setEditableText(findComposer(), content);
      },
      suppressAttachmentCaptureFor(durationMs) {
        suppressAttachmentCaptureUntil = Math.max(suppressAttachmentCaptureUntil, Date.now() + durationMs);
      },
      async submit() {
        prepareDom();
        await sleep(config.submitWaitMs ?? 150);
        const sendButton = await waitFor(() => {
          const button = findSendButton();
          return button && isSendButtonEnabled(button) ? button : null;
        }, config.submitTimeoutMs ?? 2_000);

        if (sendButton && isSendButtonEnabled(sendButton)) {
          triggerPointerClick(sendButton);
          return;
        }

        const composer = findComposer();
        if (composer) {
          dispatchEnterKey(composer);
        }
      },
    },
  };
}
