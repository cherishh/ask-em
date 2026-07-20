import type {
  AttachmentRef,
  CapturedAttachment,
  DeliverPromptMessage,
  PageState,
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
import {
  ASK_EM_FILE_INPUT_SOURCE_CAPTURE_EVENT,
  isAskEmTransientFilesMessage,
} from '../runtime/protocol';
import {
  ComposerAttachmentCaptureBuffer,
  getFilesFromDataTransfer,
  getFilesFromFileList,
  getPlainTextFromDataTransfer,
} from './attachment-capture';
import {
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
  isPrivateMode?: () => boolean;
  isPageEligible?: () => boolean;
  getIneligiblePageState?: () => PageState;
  composerSelectors: string[];
  isDropTargetForComposer?: (
    target: EventTarget | null,
    composer: HTMLElement | null,
  ) => boolean;
  sendButtonSelectors?: string[];
  findSendButton?: (
    findComposer: () => HTMLElement | null,
  ) => HTMLElement | null;
  findUserSubmitButtons?: (context: {
    findComposer: () => HTMLElement | null;
    findSendButton: () => HTMLElement | null;
  }) => HTMLElement[];
  getUserMessageTexts?: () => string[];
  deferredUserSubmitTextTimeoutMs?: number;
  loginKeywords?: string[];
  isErrorPage?: () => boolean;
  submitWaitMs?: number;
  submitTimeoutMs?: number;
  pastedTextAttachmentMinChars?: number;
  isSendButtonEnabled?: (button: HTMLElement) => boolean;
  isUserSubmitButtonEnabled?: (button: HTMLElement) => boolean;
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
  detectAttachmentUploadError?: (context: {
    findComposer: () => HTMLElement | null;
    findSendButton: () => HTMLElement | null;
  }) => string | null | Promise<string | null>;
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

function containsCapturedAttachmentName(
  text: string,
  capturedAttachments: AttachmentRef[],
): boolean {
  const compactText = compactAttachmentText(text);
  return capturedAttachments.some((attachment) => {
    const compactName = compactAttachmentText(attachment.name);
    return compactName.length > 0 && compactText.includes(compactName);
  });
}

function isDeferredSubmitLabelOnly(text: string): boolean {
  return /^(you said|user said|你说|你发送了)[:：]?$/i.test(
    normalizeWhitespace(text),
  );
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
    .filter((element) =>
      containsCapturedAttachmentName(
        getElementAccessibleText(element),
        capturedAttachments,
      ),
    );

  return candidates
    .filter(
      (candidate) =>
        !candidates.some(
          (other) => other !== candidate && candidate.contains(other),
        ),
    )
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

export function createDomProviderAdapter(
  config: DomProviderAdapterConfig,
): ProviderAdapter {
  const site = getSiteInfoByProvider(config.provider);
  const isPageEligible = () => config.isPageEligible?.() ?? true;

  const prepareDom = () => {
    if (!isPageEligible()) {
      return;
    }

    config.prepareDom?.();
  };
  const findComposer = () => {
    if (!isPageEligible()) {
      return null;
    }

    prepareDom();
    return queryVisible(config.composerSelectors);
  };
  const findSendButton = () => {
    if (!isPageEligible()) {
      return null;
    }

    prepareDom();
    return config.findSendButton
      ? config.findSendButton(findComposer)
      : queryVisible(config.sendButtonSelectors ?? []);
  };
  let suppressAttachmentCaptureUntil = 0;
  const isAttachmentCaptureSuppressed = () =>
    Date.now() < suppressAttachmentCaptureUntil;
  const isSendButtonEnabled = (button: HTMLElement) =>
    config.isSendButtonEnabled
      ? config.isSendButtonEnabled(button)
      : !button.hasAttribute('disabled');
  const isUserSubmitButtonEnabled = (button: HTMLElement) =>
    config.isUserSubmitButtonEnabled
      ? config.isUserSubmitButtonEnabled(button)
      : isSendButtonEnabled(button);
  const findUserSubmitButtons = (): HTMLElement[] => {
    if (!isPageEligible()) {
      return [];
    }

    prepareDom();
    if (config.findUserSubmitButtons) {
      return config.findUserSubmitButtons({ findComposer, findSendButton });
    }

    const sendButton = findSendButton();
    return sendButton ? [sendButton] : [];
  };
  const isFileInputForComposer = (input: HTMLInputElement) => {
    if (!isPageEligible()) {
      return false;
    }

    if (input.type !== 'file') {
      return false;
    }

    const composer = findComposer();
    const sendButton = findSendButton();
    if (config.isFileInputForComposer) {
      return config.isFileInputForComposer(input, { composer, sendButton });
    }

    const form =
      composer?.closest('form') ?? sendButton?.closest('form') ?? null;
    if (form && isElementWithin(input, form)) {
      return true;
    }

    const composerContainer =
      composer?.parentElement?.parentElement ?? composer?.parentElement ?? null;
    if (composerContainer && isElementWithin(input, composerContainer)) {
      return true;
    }

    const buttonContainer =
      sendButton?.parentElement?.parentElement ??
      sendButton?.parentElement ??
      null;
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

    const scopedFileInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    ).filter(isFileInputForComposer);
    if (
      scopedFileInputs.length > 0 &&
      capturedAttachments.every(
        (attachment) => attachment.source === 'file-input',
      )
    ) {
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
      return config.getComposerAttachmentSnapshot(
        {
          findComposer,
          findSendButton,
          isFileInputForComposer,
        },
        capturedAttachments,
      );
    }

    if (config.useGenericAttachmentSnapshot) {
      return getDefaultComposerAttachmentSnapshot(capturedAttachments);
    }

    return capturedAttachments.length === 0 ? { count: 0, items: [] } : null;
  };

  const getStatus = (): ProviderStatus => {
    prepareDom();
    const currentUrl = window.location.href;
    const isEligible = isPageEligible();
    const ineligiblePageState = isEligible
      ? null
      : (config.getIneligiblePageState?.() ?? 'not-ready');
    const authClassification = !isEligible
      ? { isLoginRequired: false }
      : config.classifyAuth
        ? config.classifyAuth()
        : config.isLoginRequired
          ? { isLoginRequired: config.isLoginRequired() }
          : {
            isLoginRequired: detectLoginRequired(config.loginKeywords ?? []),
          };
    const isLoginRequired = authClassification.isLoginRequired;
    const isPrivateMode = isEligible && (config.isPrivateMode?.() ?? false);
    const hasHardError = isEligible ? (config.isErrorPage?.() ?? false) : false;
    const isReady = isEligible && Boolean(findComposer());
    const pageState =
      ineligiblePageState ??
      (isPrivateMode
        ? 'private-mode'
        : isLoginRequired
          ? 'login-required'
          : hasHardError
            ? 'error'
            : isReady
              ? 'ready'
              : 'not-ready');

    return {
      provider: config.provider,
      currentUrl,
      sessionId: site.extractSessionId(currentUrl),
      pageKind: site.isBlankChatUrl(currentUrl)
        ? 'new-chat'
        : 'existing-session',
      pageState,
      authRule: isLoginRequired ? authClassification.rule : undefined,
      authSignalSummary: isLoginRequired
        ? authClassification.signals
        : undefined,
    };
  };

  const canDeliverPrompt = (
    message: DeliverPromptMessage,
    snapshot: AdapterSnapshot,
  ): boolean => {
    if (
      message.provider !== config.provider ||
      snapshot.pageState !== 'ready'
    ) {
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
        let pendingDeferredSubmitBaseline: {
          button: HTMLElement;
          messages: string[];
          capturedAt: number;
          waitStarted: boolean;
        } | null = null;
        const buildUserSubmissionPayload = (text: string) => {
          let capturedAttachments = attachmentBuffer.getAttachmentsForSubmit();
          if (capturedAttachments.length === 0) {
            const lateFiles = Array.from(
              document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
            )
              .filter(isFileInputForComposer)
              .flatMap((input) => getFilesFromFileList(input.files));
            if (lateFiles.length > 0) {
              attachmentBuffer.addFiles(lateFiles, 'file-input');
              capturedAttachments = attachmentBuffer.getAttachmentsForSubmit();
            }
          }

          const attachmentSnapshot =
              getComposerAttachmentSnapshot(capturedAttachments);
          const attachmentResolution: AttachmentSubmitResolution = {
            ...attachmentBuffer.resolveAttachmentsForSubmit(attachmentSnapshot),
            capturedItems: capturedAttachments.map((attachment) =>
              `${attachment.id.slice(0, 8)}:${attachment.source}:${attachment.name}:${attachment.mime}:${attachment.size}b`,
            ),
            currentItems: attachmentSnapshot?.items ?? [],
          };

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
          const isComposerDrop = config.isDropTargetForComposer
            ? config.isDropTargetForComposer(event.target, composer)
            : isElementWithin(event.target, composer);
          if (!isComposerDrop) {
            return;
          }

          attachmentBuffer.addFiles(
            getFilesFromDataTransfer(event.dataTransfer),
            'drop',
          );
        };

        const handleFileInputChange = (event: Event) => {
          if (isAttachmentCaptureSuppressed()) {
            return;
          }

          const input =
            event.target instanceof HTMLInputElement ? event.target : null;
          if (
            !input ||
            input.type !== 'file' ||
            !isFileInputForComposer(input)
          ) {
            return;
          }

          const files = getFilesFromFileList(input.files);
          if (files.length === 0) {
            return;
          }

          attachmentBuffer.addFiles(files, 'file-input');
        };

        const handleMainFileInputSourceCapture = (event: Event) => {
          if (isAttachmentCaptureSuppressed()) {
            return;
          }

          const input =
            event.target instanceof HTMLInputElement ? event.target : null;
          if (
            !input ||
            input.type !== 'file' ||
            !isFileInputForComposer(input)
          ) {
            return;
          }

          attachmentBuffer.addFiles(
            getFilesFromFileList(input.files),
            'main-file-input',
          );
        };

        const handleTransientFilesMessage = (event: MessageEvent) => {
          if (
            event.source !== window ||
            (event.origin && event.origin !== window.location.origin) ||
            isAttachmentCaptureSuppressed()
          ) {
            return;
          }

          if (!isAskEmTransientFilesMessage(event.data)) {
            return;
          }

          // The MAIN-world transient hook shares the page's global, so a malicious
          // page script could forge this message. That cannot exfiltrate files:
          // the submit-time source-DOM snapshot gate (resolveAttachmentsForSubmit)
          // fan-out only files that match a real composer attachment card, so a
          // forged buffer entry is dropped fail-closed rather than synced.
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

        const waitForDeferredSubmittedText = (
          baselineUserMessages: string[],
          submitButton: HTMLElement,
        ) => {
          void waitFor(() => {
            const currentUserMessages =
              config
                .getUserMessageTexts?.()
                .map(normalizeWhitespace)
                .filter(Boolean) ?? [];
            if (currentUserMessages.length <= baselineUserMessages.length) {
              return null;
            }

            const submittedText = currentUserMessages.at(-1);
            return submittedText && !isDeferredSubmitLabelOnly(submittedText)
              ? submittedText
              : null;
          }, config.deferredUserSubmitTextTimeoutMs ?? 4_000).then(
            (submittedText) => {
              if (!submittedText) {
                return;
              }

              if (
                pendingDeferredSubmitBaseline?.button === submitButton &&
                pendingDeferredSubmitBaseline.waitStarted
              ) {
                pendingDeferredSubmitBaseline = null;
              }

              onSubmit(buildUserSubmissionPayload(submittedText));
            },
          );
        };

        const captureDeferredSubmitBaseline = (event: Event) => {
          if (!config.getUserMessageTexts) {
            return;
          }

          const submitButton = findUserSubmitButtons().find(
            (button) =>
              isUserSubmitButtonEnabled(button) &&
              isElementWithin(event.target, button),
          );
          if (!submitButton) {
            return;
          }

          if (getEditableText(findComposer()).trim().length > 0) {
            pendingDeferredSubmitBaseline = null;
            return;
          }

          if (
            pendingDeferredSubmitBaseline?.button === submitButton &&
            Date.now() - pendingDeferredSubmitBaseline.capturedAt < 500
          ) {
            return;
          }

          pendingDeferredSubmitBaseline = {
            button: submitButton,
            messages: config
              .getUserMessageTexts()
              .map(normalizeWhitespace)
              .filter(Boolean),
            capturedAt: Date.now(),
            waitStarted: true,
          };
          waitForDeferredSubmittedText(
            pendingDeferredSubmitBaseline.messages,
            submitButton,
          );
        };

        const handleClick = (event: MouseEvent) => {
          const submitButton = findUserSubmitButtons().find(
            (button) =>
              isUserSubmitButtonEnabled(button) &&
              isElementWithin(event.target, button),
          );
          if (submitButton) {
            const payload = buildUserSubmissionPayload(
              getEditableText(findComposer()),
            );
            if (
              payload.text.trim().length > 0 ||
              payload.attachments.length > 0
            ) {
              onSubmit(payload);
              return;
            }

            const pendingBaseline =
              pendingDeferredSubmitBaseline &&
              pendingDeferredSubmitBaseline.button === submitButton &&
              Date.now() - pendingDeferredSubmitBaseline.capturedAt < 5_000
                ? pendingDeferredSubmitBaseline
                : null;
            if (pendingBaseline?.waitStarted) {
              return;
            }

            pendingDeferredSubmitBaseline = null;
            const baselineUserMessages =
              pendingBaseline ??
              config
                .getUserMessageTexts?.()
                .map(normalizeWhitespace)
                .filter(Boolean);
            if (!baselineUserMessages) {
              return;
            }

            waitForDeferredSubmittedText(
              Array.isArray(baselineUserMessages)
                ? baselineUserMessages
                : baselineUserMessages.messages,
              submitButton,
            );
          }
        };

        document.addEventListener('paste', handlePaste, true);
        document.addEventListener('drop', handleDrop, true);
        document.addEventListener('change', handleFileInputChange, true);
        document.addEventListener(
          ASK_EM_FILE_INPUT_SOURCE_CAPTURE_EVENT,
          handleMainFileInputSourceCapture,
          true,
        );
        window.addEventListener('message', handleTransientFilesMessage);
        document.addEventListener('keydown', handleKeydown, true);
        document.addEventListener(
          'pointerdown',
          captureDeferredSubmitBaseline,
          true,
        );
        document.addEventListener(
          'mousedown',
          captureDeferredSubmitBaseline,
          true,
        );
        document.addEventListener('click', handleClick, true);

        return () => {
          document.removeEventListener('paste', handlePaste, true);
          document.removeEventListener('drop', handleDrop, true);
          document.removeEventListener('change', handleFileInputChange, true);
          document.removeEventListener(
            ASK_EM_FILE_INPUT_SOURCE_CAPTURE_EVENT,
            handleMainFileInputSourceCapture,
            true,
          );
          window.removeEventListener('message', handleTransientFilesMessage);
          document.removeEventListener('keydown', handleKeydown, true);
          document.removeEventListener(
            'pointerdown',
            captureDeferredSubmitBaseline,
            true,
          );
          document.removeEventListener(
            'mousedown',
            captureDeferredSubmitBaseline,
            true,
          );
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
        return (
          config.getComposerAttachmentPresence?.(
            {
              findComposer,
              findSendButton,
            },
            expectedAttachments,
          ) ?? { count: 0 }
        );
      },
      getComposerAttachmentSnapshot(capturedAttachments) {
        return getComposerAttachmentSnapshot(capturedAttachments ?? []);
      },
      detectAttachmentUploadError() {
        return (
          config.detectAttachmentUploadError?.({
            findComposer,
            findSendButton,
          }) ?? null
        );
      },
      suppressAttachmentCaptureFor(durationMs) {
        suppressAttachmentCaptureUntil = Math.max(
          suppressAttachmentCaptureUntil,
          Date.now() + durationMs,
        );
      },
      async submit(options) {
        prepareDom();
        await sleep(config.submitWaitMs ?? 150);
        const sendButton = await waitFor(
          () => {
            const button = findSendButton();
            return button && isSendButtonEnabled(button) ? button : null;
          },
          options?.timeoutMs ?? config.submitTimeoutMs ?? 2_000,
        );

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
