export const ASK_EM_BRIDGE_SOURCE = 'ask-em';

export const ASK_EM_TRANSIENT_FILES = 'ASK_EM_TRANSIENT_FILES';
export const ASK_EM_FILE_INPUT_DELIVERY = 'ASK_EM_FILE_INPUT_DELIVERY';
export const ASK_EM_FILE_INPUT_DELIVERY_RESULT = 'ASK_EM_FILE_INPUT_DELIVERY_RESULT';
export const ASK_EM_FILE_INPUT_TOKEN_ATTRIBUTE = 'data-ask-em-file-input-token';

export type AskEmTransientFilesMessage = {
  source: typeof ASK_EM_BRIDGE_SOURCE;
  type: typeof ASK_EM_TRANSIENT_FILES;
  files: File[];
};

export type AskEmFileInputDeliveryMessage = {
  source: typeof ASK_EM_BRIDGE_SOURCE;
  type: typeof ASK_EM_FILE_INPUT_DELIVERY;
  requestId: string;
  inputToken: string;
  files: File[];
};

export type AskEmFileInputDeliveryResultMessage = {
  source: typeof ASK_EM_BRIDGE_SOURCE;
  type: typeof ASK_EM_FILE_INPUT_DELIVERY_RESULT;
  requestId: string;
  ok: boolean;
  error?: string;
};

function isFileLike(value: unknown): value is File {
  return (
    (typeof File !== 'undefined' && value instanceof File) ||
    Object.prototype.toString.call(value) === '[object File]'
  );
}

export function isAskEmTransientFilesMessage(value: unknown): value is AskEmTransientFilesMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<AskEmTransientFilesMessage>;
  return (
    candidate.source === ASK_EM_BRIDGE_SOURCE &&
    candidate.type === ASK_EM_TRANSIENT_FILES &&
    Array.isArray(candidate.files) &&
    candidate.files.every(isFileLike)
  );
}

export function isAskEmFileInputDeliveryMessage(value: unknown): value is AskEmFileInputDeliveryMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<AskEmFileInputDeliveryMessage>;
  return (
    candidate.source === ASK_EM_BRIDGE_SOURCE &&
    candidate.type === ASK_EM_FILE_INPUT_DELIVERY &&
    typeof candidate.requestId === 'string' &&
    typeof candidate.inputToken === 'string' &&
    Array.isArray(candidate.files) &&
    candidate.files.every(isFileLike)
  );
}

export function isAskEmFileInputDeliveryResultMessage(
  value: unknown,
): value is AskEmFileInputDeliveryResultMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<AskEmFileInputDeliveryResultMessage>;
  return (
    candidate.source === ASK_EM_BRIDGE_SOURCE &&
    candidate.type === ASK_EM_FILE_INPUT_DELIVERY_RESULT &&
    typeof candidate.requestId === 'string' &&
    typeof candidate.ok === 'boolean'
  );
}
