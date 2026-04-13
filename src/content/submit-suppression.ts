export type SubmitSuppressionState = {
  suppressSubmissionsUntil: number;
};

export function isSubmissionSuppressed(
  state: SubmitSuppressionState,
  now = Date.now(),
): boolean {
  return now < state.suppressSubmissionsUntil;
}

export function suppressObservedSubmissions(
  state: SubmitSuppressionState,
  durationMs: number,
  now = Date.now(),
) {
  state.suppressSubmissionsUntil = now + durationMs;
}
