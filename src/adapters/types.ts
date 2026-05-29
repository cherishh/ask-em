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
};

export type ComposerPayload = {
  text: string;
  attachments: AttachmentRef[];
};

export type ComposerAttachmentPresence = {
  count: number;
  keys?: string[];
};

export interface ProviderComposerAdapter {
  subscribeToUserSubmissions?(onSubmit: (payload: UserSubmissionPayload) => void): () => void;
  setComposerPayload?(payload: ComposerPayload): Promise<void> | void;
  setComposerText(content: string): Promise<void> | void;
  detectAttachmentUploadError?(): string | null | Promise<string | null>;
  getComposerAttachmentPresence?(): ComposerAttachmentPresence | Promise<ComposerAttachmentPresence>;
  submit(): Promise<void> | void;
}

export interface ProviderAdapter {
  name: Provider;
  uploadCapability?: UploadCapability;
  getUiSpec(): ProviderUiSpec;
  session: ProviderSessionAdapter;
  composer?: ProviderComposerAdapter;
}
