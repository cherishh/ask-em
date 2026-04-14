/// <reference types="chrome" />

interface ImportMetaEnv {
  readonly WXT_SUPPORT_API_BASE_URL?: string;
  readonly WXT_SUPPORT_API_ORIGIN?: string;
  readonly WXT_MORE_PROVIDERS_REQUEST_ENDPOINT?: string;
  readonly WXT_FEEDBACK_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  dev_control?: boolean;
}
