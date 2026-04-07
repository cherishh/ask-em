import type {
  DeliverPromptMessage,
  PageKind,
  PageState,
  Provider,
  ProviderStatus,
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

export interface SiteAdapter {
  name: Provider;
  getCurrentUrl(): string;
  getStatus(): ProviderStatus;
  getUiSpec(): ProviderUiSpec;
  subscribeToUserSubmissions?(onSubmit: (content: string) => void): () => void;
  setComposerText?(content: string): Promise<void> | void;
  submit?(): Promise<void> | void;
  waitForSessionRefUpdate?(
    baselineUrl: string,
  ): Promise<{ sessionId: string | null; url: string }>;
  canDeliverPrompt?(
    message: DeliverPromptMessage,
    snapshot: AdapterSnapshot,
  ): boolean;
}
