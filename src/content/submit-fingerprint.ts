const DUPLICATE_SUBMIT_WINDOW_MS = 1_500;

export type SubmitFingerprintState = {
  lastFingerprint: string;
  lastFingerprintAt: number;
};

export function shouldSkipDuplicateSubmit(
  state: SubmitFingerprintState,
  fingerprint: string,
  now = Date.now(),
) {
  return (
    fingerprint === state.lastFingerprint &&
    now - state.lastFingerprintAt < DUPLICATE_SUBMIT_WINDOW_MS
  );
}

export function rememberSubmitFingerprint(
  state: SubmitFingerprintState,
  fingerprint: string,
  now = Date.now(),
) {
  state.lastFingerprint = fingerprint;
  state.lastFingerprintAt = now;
}
