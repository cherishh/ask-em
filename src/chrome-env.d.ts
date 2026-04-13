/// <reference types="chrome" />

interface ImportMetaEnv {
  readonly WXT_MORE_PROVIDERS_REQUEST_ENDPOINT?: string;
  readonly WXT_FEEDBACK_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  dev_control?: boolean;
}
