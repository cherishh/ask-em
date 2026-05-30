import type {
  AttachmentRef,
  CapturedAttachment,
  DeliverPromptMessage,
  Provider,
  ProviderStatus,
  UploadCapability,
} from '../runtime/protocol';
import type {
  AttachmentSubmitResolution,
  ComposerDeliveryPreparation,
  ComposerAttachmentPresence,
  ComposerAttachmentSnapshot,
  ComposerPayload,
} from './types';
import { isAskEmTransientFilesMessage } from '../runtime/protocol';
import {
  ComposerAttachmentCaptureBuffer,
  getFilesFromDataTransfer,
  getFilesFromFileList,
  getPlainTextFromDataTransfer,
} from './attachment-capture';
import {
  detectObviousErrorPage,
  detectLoginRequired,
  dispatchEnterKey,
  getEditableText,
  isElementWithin,
  isVisible,
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
  pastedTextAttachmentMinChars?: number;
  isSendButtonEnabled?: (button: HTMLElement) => boolean;
  useGenericAttachmentSnapshot?: boolean;
  setComposerPayload?: (
    payload: ComposerPayload,
    context: {
      findComposer: () => HTMLElement | null;
      findSendButton: () => HTMLElement | null;
      setComposerText: (content: string) => Promise<void>;
    },
  ) => Promise<void> | void;
  prepareForDelivery?: (
    payload: ComposerDeliveryPreparation,
    context: {
      findComposer: () => HTMLElement | null;
      findSendButton: () => HTMLElement | null;
    },
  ) => Promise<void> | void;
  getComposerAttachmentPresence?: (
    context: {
      findComposer: () => HTMLElement | null;
      findSendButton: () => HTMLElement | null;
    },
    expectedAttachments?: AttachmentRef[],
  ) => ComposerAttachmentPresence | Promise<ComposerAttachmentPresence>;
  getComposerAttachmentSnapshot?: (
    context: {
      findComposer: () => HTMLElement | null;
      findSendButton: () => HTMLElement | null;
      isFileInputForComposer: (input: HTMLInputElement) => boolean;
    },
    capturedAttachments: CapturedAttachment[],
  ) => ComposerAttachmentSnapshot | null;
  detectAttachmentUploadError?: (
    context: {
      findComposer: () => HTMLElement | null;
      findSendButton: () => HTMLElement | null;
    },
  ) => string | null | Promise<string | null>;
  isFileInputForComposer?: (
    input: HTMLInputElement,
    context: {
      composer: HTMLElement | null;
      sendButton: HTMLElement | null;
    },
  ) => boolean;
};

const ATTACHMENT_LABEL_SELECTORS = [
  '[data-testid*="attachment" i]',
  '[data-testid*="file" i]',
  '[aria-label*="attachment" i]',
  '[aria-label*="file" i]',
  '[class*="attachment" i]',
  '[class*="file" i]',
];

function getElementAccessibleText(element: HTMLElement): string {
  return normalizeWhitespace(
    [
      element.getAttribute('aria-label'),
      element.getAttribute('aria-describedby'),
      element.getAttribute('title'),
      element.innerText || element.textContent,
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function compactAttachmentText(value: string): string {
  return normalizeWhitespace(value).replace(/\s+/g, '').toLowerCase();
}

function containsCapturedAttachmentName(text: string, capturedAttachments: AttachmentRef[]): boolean {
  const compactText = compactAttachmentText(text);
  return capturedAttachments.some((attachment) => {
    const compactName = compactAttachmentText(attachment.name);
    return compactName.length > 0 && compactText.includes(compactName);
  });
}

function findGenericAttachmentSnapshotLabels(
  container: ParentNode,
  capturedAttachments: AttachmentRef[],
): string[] {
  if (!(container instanceof Element || container instanceof Document)) {
    return [];
  }

  const candidates = ATTACHMENT_LABEL_SELECTORS.flatMap((selector) =>
    Array.from(container.querySelectorAll<HTMLElement>(selector)),
  )
    .filter((element, index, elements) => elements.indexOf(element) === index)
    .filter(isVisible)
    .filter((element) => containsCapturedAttachmentName(getElementAccessibleText(element), capturedAttachments));

  return candidates
    .filter((candidate) => !candidates.some((other) => other !== candidate && candidate.contains(other)))
    .map(getElementAccessibleText)
    .filter(Boolean);
}

function getAttachmentSnapshotContainer(
  composer: HTMLElement | null,
  sendButton: HTMLElement | null,
): ParentNode {
  const form = composer?.closest('form') ?? sendButton?.closest('form') ?? null;
  if (form) {
    return form;
  }

  return (
    composer?.parentElement?.parentElement?.parentElement ??
    composer?.parentElement?.parentElement ??
    sendButton?.parentElement?.parentElement ??
    document
  );
}

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
  const getDefaultComposerAttachmentSnapshot = (
    capturedAttachments: CapturedAttachment[],
  ): ComposerAttachmentSnapshot | null => {
    if (capturedAttachments.length === 0) {
      return {
        count: 0,
        items: [],
      };
    }

    const composer = findComposer();
    const sendButton = findSendButton();
    const labels = findGenericAttachmentSnapshotLabels(
      getAttachmentSnapshotContainer(composer, sendButton),
      capturedAttachments,
    );

    if (labels.length > 0) {
      return {
        count: labels.length,
        items: labels,
      };
    }

    const scopedFileInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'))
      .filter(isFileInputForComposer);
    if (scopedFileInputs.length > 0 && capturedAttachments.every((attachment) => attachment.source === 'file-input')) {
      return {
        count: 0,
        items: [],
      };
    }

    return null;
  };
  const getComposerAttachmentSnapshot = (
    capturedAttachments: CapturedAttachment[],
  ): ComposerAttachmentSnapshot | null => {
    if (config.getComposerAttachmentSnapshot) {
      return config.getComposerAttachmentSnapshot({
        findComposer,
        findSendButton,
        isFileInputForComposer,
      }, capturedAttachments);
    }

    if (config.useGenericAttachmentSnapshot) {
      return getDefaultComposerAttachmentSnapshot(capturedAttachments);
    }

    return capturedAttachments.length === 0 ? { count: 0, items: [] } : null;
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
  const setComposerText = async (content: string) => {
    prepareDom();
    setEditableText(findComposer(), content);
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
        const buildUserSubmissionPayload = (text: string) => {
          let capturedAttachments = attachmentBuffer.getAttachmentsForSubmit();
          if (capturedAttachments.length === 0) {
            const lateFiles = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'))
              .filter(isFileInputForComposer)
              .flatMap((input) => getFilesFromFileList(input.files));
            if (lateFiles.length > 0) {
              attachmentBuffer.addFiles(lateFiles, 'file-input');
              capturedAttachments = attachmentBuffer.getAttachmentsForSubmit();
            }
          }

          const attachmentResolution: AttachmentSubmitResolution = attachmentBuffer.resolveAttachmentsForSubmit(
            capturedAttachments.length > 0 ? getComposerAttachmentSnapshot(capturedAttachments) : {
              count: 0,
              items: [],
            },
          );

          return {
            text,
            attachments: attachmentResolution.attachments,
            attachmentResolution,
            onConsumed: () => attachmentBuffer.clear(),
          };
        };

        const handlePaste = (event: ClipboardEvent) => {
          if (isAttachmentCaptureSuppressed()) {
            return;
          }

          const composer = findComposer();
          if (!isElementWithin(event.target, composer)) {
            return;
          }

          const files = getFilesFromDataTransfer(event.clipboardData);
          attachmentBuffer.addFiles(files, 'paste');
          if (files.length === 0 && config.pastedTextAttachmentMinChars) {
            attachmentBuffer.addPastedText(
              getPlainTextFromDataTransfer(event.clipboardData),
              config.pastedTextAttachmentMinChars,
            );
          }
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
            onSubmit(buildUserSubmissionPayload(getEditableText(composer)));
          }
        };

        const handleClick = (event: MouseEvent) => {
          const sendButton = findSendButton();
          if (sendButton && isSendButtonEnabled(sendButton) && isElementWithin(event.target, sendButton)) {
            onSubmit(buildUserSubmissionPayload(getEditableText(findComposer())));
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
        await setComposerText(content);
      },
      async prepareForDelivery(payload) {
        await config.prepareForDelivery?.(payload, {
          findComposer,
          findSendButton,
        });
      },
      async setComposerPayload(payload) {
        if (config.setComposerPayload) {
          await config.setComposerPayload(payload, {
            findComposer,
            findSendButton,
            setComposerText,
          });
          return;
        }

        if (payload.attachments.length > 0) {
          throw new Error('Provider does not support attachment delivery');
        }

        await setComposerText(payload.text);
      },
      getComposerAttachmentPresence(expectedAttachments) {
        return config.getComposerAttachmentPresence?.({
          findComposer,
          findSendButton,
        }, expectedAttachments) ?? { count: 0 };
      },
      getComposerAttachmentSnapshot(capturedAttachments) {
        return getComposerAttachmentSnapshot(capturedAttachments ?? []);
      },
      detectAttachmentUploadError() {
        return config.detectAttachmentUploadError?.({
          findComposer,
          findSendButton,
        }) ?? null;
      },
      suppressAttachmentCaptureFor(durationMs) {
        suppressAttachmentCaptureUntil = Math.max(suppressAttachmentCaptureUntil, Date.now() + durationMs);
      },
      async submit(options) {
        prepareDom();
        await sleep(config.submitWaitMs ?? 150);
        const sendButton = await waitFor(() => {
          const button = findSendButton();
          return button && isSendButtonEnabled(button) ? button : null;
        }, options?.timeoutMs ?? config.submitTimeoutMs ?? 2_000);

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
