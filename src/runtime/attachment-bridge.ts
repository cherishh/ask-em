export const ASK_EM_BRIDGE_SOURCE = 'ask-em';

export const ASK_EM_TRANSIENT_FILES = 'ASK_EM_TRANSIENT_FILES';

export type AskEmTransientFilesMessage = {
  source: typeof ASK_EM_BRIDGE_SOURCE;
  type: typeof ASK_EM_TRANSIENT_FILES;
  files: File[];
};

export function isAskEmTransientFilesMessage(value: unknown): value is AskEmTransientFilesMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<AskEmTransientFilesMessage>;
  return (
    candidate.source === ASK_EM_BRIDGE_SOURCE &&
    candidate.type === ASK_EM_TRANSIENT_FILES &&
    Array.isArray(candidate.files) &&
    candidate.files.every((file) => file instanceof File)
  );
}
