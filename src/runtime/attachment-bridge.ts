export const ASK_EM_BRIDGE_SOURCE = 'ask-em';

export const ASK_EM_TRANSIENT_FILES = 'ASK_EM_TRANSIENT_FILES';
export const ASK_EM_FILE_INPUT_SOURCE_CAPTURE_EVENT =
  'ask-em:file-input-source-capture';
export const ASK_EM_TRANSIENT_FILE_INPUT_DELIVERY = 'ASK_EM_TRANSIENT_FILE_INPUT_DELIVERY';
export const ASK_EM_TRANSIENT_FILE_INPUT_DELIVERY_RESULT = 'ASK_EM_TRANSIENT_FILE_INPUT_DELIVERY_RESULT';
export const ASK_EM_FILE_INPUT_DELIVERY = 'ASK_EM_FILE_INPUT_DELIVERY';
export const ASK_EM_FILE_INPUT_DELIVERY_RESULT = 'ASK_EM_FILE_INPUT_DELIVERY_RESULT';
export const ASK_EM_FILE_INPUT_TOKEN_ATTRIBUTE = 'data-ask-em-file-input-token';

export type AskEmTransientFilesMessage = {
  source: typeof ASK_EM_BRIDGE_SOURCE;
  type: typeof ASK_EM_TRANSIENT_FILES;
  files: File[];
};

export type AskEmTransientFileInputDeliveryMessage = {
  source: typeof ASK_EM_BRIDGE_SOURCE;
  type: typeof ASK_EM_TRANSIENT_FILE_INPUT_DELIVERY;
  requestId: string;
  files: File[];
};

export type AskEmSerializedFile = {
  name: string;
  type: string;
  lastModified: number;
  bytes: ArrayBuffer;
};

export type AskEmTransientFileInputDeliveryResultMessage = {
  source: typeof ASK_EM_BRIDGE_SOURCE;
  type: typeof ASK_EM_TRANSIENT_FILE_INPUT_DELIVERY_RESULT;
  requestId: string;
  ok: boolean;
  error?: string;
};

type AskEmFileInputDeliveryMessageBase = {
  source: typeof ASK_EM_BRIDGE_SOURCE;
  type: typeof ASK_EM_FILE_INPUT_DELIVERY;
  requestId: string;
  inputToken: string;
};

export type AskEmFileInputDeliveryMessage =
  | (AskEmFileInputDeliveryMessageBase & {
    encoding?: 'native';
    files: File[];
  })
  | (AskEmFileInputDeliveryMessageBase & {
    encoding: 'serialized';
    files: AskEmSerializedFile[];
  });

export type AskEmFileInputDeliveryResultMessage = {
  source: typeof ASK_EM_BRIDGE_SOURCE;
  type: typeof ASK_EM_FILE_INPUT_DELIVERY_RESULT;
  requestId: string;
  ok: boolean;
  error?: string;
};

function isFileLike(value: unknown): value is File {
  // Duck-type rather than `instanceof File`: the isolated content world and the
  // page MAIN world can hand each other cross-realm File-like objects whose
  // prototype chain differs, so identity checks are unreliable. This mirrors the
  // capture-side isFileLike (adapters/attachment-capture.ts) per design §6.
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<File>;
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.type === 'string' &&
    typeof candidate.size === 'number' &&
    typeof candidate.arrayBuffer === 'function'
  );
}

function isArrayBufferLike(value: unknown): value is ArrayBuffer {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<ArrayBuffer>;
  return typeof candidate.byteLength === 'number' && typeof candidate.slice === 'function';
}

function isSerializedFile(value: unknown): value is AskEmSerializedFile {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<AskEmSerializedFile>;
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.type === 'string' &&
    typeof candidate.lastModified === 'number' &&
    isArrayBufferLike(candidate.bytes)
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

export function isAskEmTransientFileInputDeliveryMessage(
  value: unknown,
): value is AskEmTransientFileInputDeliveryMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<AskEmTransientFileInputDeliveryMessage>;
  return (
    candidate.source === ASK_EM_BRIDGE_SOURCE &&
    candidate.type === ASK_EM_TRANSIENT_FILE_INPUT_DELIVERY &&
    typeof candidate.requestId === 'string' &&
    Array.isArray(candidate.files) &&
    candidate.files.every(isFileLike)
  );
}

export function isAskEmTransientFileInputDeliveryResultMessage(
  value: unknown,
): value is AskEmTransientFileInputDeliveryResultMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<AskEmTransientFileInputDeliveryResultMessage>;
  return (
    candidate.source === ASK_EM_BRIDGE_SOURCE &&
    candidate.type === ASK_EM_TRANSIENT_FILE_INPUT_DELIVERY_RESULT &&
    typeof candidate.requestId === 'string' &&
    typeof candidate.ok === 'boolean'
  );
}

export function isAskEmFileInputDeliveryMessage(value: unknown): value is AskEmFileInputDeliveryMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<AskEmFileInputDeliveryMessage>;
  const hasValidEnvelope =
    candidate.source === ASK_EM_BRIDGE_SOURCE &&
    candidate.type === ASK_EM_FILE_INPUT_DELIVERY &&
    typeof candidate.requestId === 'string' &&
    typeof candidate.inputToken === 'string' &&
    Array.isArray(candidate.files);
  if (!hasValidEnvelope) {
    return false;
  }

  if (candidate.encoding === 'serialized') {
    return candidate.files?.every(isSerializedFile) ?? false;
  }

  return (
    (candidate.encoding === undefined || candidate.encoding === 'native') &&
    (candidate.files?.every(isFileLike) ?? false)
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
