import type {
  AttachmentRef,
  CapturedAttachment,
  DeliverPromptMessage,
  PageKind,
  PageState,
  Provider,
  ProviderStatus,
  UploadCapability,
} from '../runtime/protocol';

export type { Provider };

export interface AdapterSnapshot {
  provider: Provider;
  currentUrl: string;
  sessionId: string | null;
  pageState: PageState;
  pageKind: PageKind;
}

export interface ProviderUiSpec {
  mountId: string;
  className: string;
}

export interface ProviderSessionAdapter {
  getCurrentUrl(): string;
  getStatus(): ProviderStatus;
  waitForSessionRefUpdate?(
    baselineUrl: string,
  ): Promise<{ sessionId: string | null; url: string }>;
  canDeliverPrompt?(
    message: DeliverPromptMessage,
    snapshot: AdapterSnapshot,
  ): boolean;
}

export type UserSubmissionPayload = {
  text: string;
  attachments: CapturedAttachment[];
  attachmentResolution?: AttachmentSubmitResolution;
  onConsumed?: () => void;
};

export type ComposerPayload = {
  text: string;
  attachments: AttachmentRef[];
};

export type ComposerAttachmentPresence = {
  count: number;
  keys?: string[];
};

export type ComposerAttachmentSnapshot = {
  count: number;
  items?: string[];
};

export type AttachmentSubmitResolutionReason =
  | 'no-captured-attachments'
  | 'no-current-attachments'
  | 'missing-source-snapshot'
  | 'ambiguous-current-attachments'
  | 'unmatched-current-attachments';

export type AttachmentSubmitResolution = {
  attachments: CapturedAttachment[];
  capturedCount: number;
  currentCount: number | null;
  submittedCount: number;
  reason?: AttachmentSubmitResolutionReason;
};

export interface ProviderComposerAdapter {
  subscribeToUserSubmissions?(onSubmit: (payload: UserSubmissionPayload) => void): () => void;
  setComposerPayload?(payload: ComposerPayload): Promise<void> | void;
  setComposerText(content: string): Promise<void> | void;
  detectAttachmentUploadError?(): string | null | Promise<string | null>;
  getComposerAttachmentSnapshot?(
    capturedAttachments?: CapturedAttachment[],
  ): ComposerAttachmentSnapshot | null;
  getComposerAttachmentPresence?(
    expectedAttachments?: AttachmentRef[],
  ): ComposerAttachmentPresence | Promise<ComposerAttachmentPresence>;
  suppressAttachmentCaptureFor?(durationMs: number): void;
  submit(options?: { timeoutMs?: number }): Promise<void> | void;
}

export interface ProviderAdapter {
  name: Provider;
  uploadCapability?: UploadCapability;
  getUiSpec(): ProviderUiSpec;
  session: ProviderSessionAdapter;
  composer?: ProviderComposerAdapter;
}
