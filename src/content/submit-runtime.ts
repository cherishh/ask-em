import {
  rememberProgrammaticSubmit,
  shouldSuppressProgrammaticSubmit,
  type RecentProgrammaticSubmitState,
} from './submit-memory';
import {
  rememberSubmitFingerprint,
  shouldSkipDuplicateSubmit,
} from './submit-fingerprint';
import {
  isSubmissionSuppressed,
  suppressObservedSubmissions,
  type SubmitSuppressionState,
} from './submit-suppression';

export type SubmitRuntime = SubmitSuppressionState &
  RecentProgrammaticSubmitState & {
    lastFingerprint: string;
    lastFingerprintAt: number;
  };

export function createInitialSubmitRuntime(): SubmitRuntime {
  return {
    suppressSubmissionsUntil: 0,
    lastFingerprint: '',
    lastFingerprintAt: 0,
    recentProgrammaticSubmits: new Map<string, number>(),
  };
}

export function isSubmitRuntimeSuppressed(
  submitRuntime: SubmitRuntime,
  now = Date.now(),
): boolean {
  return isSubmissionSuppressed(submitRuntime, now);
}

export function suppressSubmitRuntime(
  submitRuntime: SubmitRuntime,
  durationMs: number,
  now = Date.now(),
) {
  suppressObservedSubmissions(submitRuntime, durationMs, now);
}

export function rememberProgrammaticSubmitInRuntime(
  submitRuntime: SubmitRuntime,
  content: string,
  now = Date.now(),
) {
  rememberProgrammaticSubmit(submitRuntime, content, now);
}

export function shouldSuppressProgrammaticSubmitInRuntime(
  submitRuntime: SubmitRuntime,
  content: string,
  now = Date.now(),
) {
  return shouldSuppressProgrammaticSubmit(submitRuntime, content, now);
}

export function shouldSkipDuplicateSubmitInRuntime(
  submitRuntime: SubmitRuntime,
  fingerprint: string,
  now = Date.now(),
) {
  return shouldSkipDuplicateSubmit(
    {
      lastFingerprint: submitRuntime.lastFingerprint,
      lastFingerprintAt: submitRuntime.lastFingerprintAt,
    },
    fingerprint,
    now,
  );
}

export function rememberSubmitFingerprintInRuntime(
  submitRuntime: SubmitRuntime,
  fingerprint: string,
  now = Date.now(),
) {
  const state = {
    lastFingerprint: submitRuntime.lastFingerprint,
    lastFingerprintAt: submitRuntime.lastFingerprintAt,
  };
  rememberSubmitFingerprint(state, fingerprint, now);
  submitRuntime.lastFingerprint = state.lastFingerprint;
  submitRuntime.lastFingerprintAt = state.lastFingerprintAt;
}
