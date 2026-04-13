const PROGRAMMATIC_SUBMIT_SUPPRESS_MS = 30_000;

export type RecentProgrammaticSubmitState = {
  recentProgrammaticSubmits: Map<string, number>;
};

export function getSubmitContentFingerprint(content: string): string {
  return content.trim();
}

export function rememberProgrammaticSubmit(
  state: RecentProgrammaticSubmitState,
  content: string,
  now = Date.now(),
) {
  state.recentProgrammaticSubmits.set(
    getSubmitContentFingerprint(content),
    now + PROGRAMMATIC_SUBMIT_SUPPRESS_MS,
  );
}

export function shouldSuppressProgrammaticSubmit(
  state: RecentProgrammaticSubmitState,
  content: string,
  now = Date.now(),
): boolean {
  for (const [fingerprint, expiresAt] of state.recentProgrammaticSubmits) {
    if (expiresAt <= now) {
      state.recentProgrammaticSubmits.delete(fingerprint);
    }
  }

  const fingerprint = getSubmitContentFingerprint(content);
  const expiresAt = state.recentProgrammaticSubmits.get(fingerprint);

  if (!expiresAt || expiresAt <= now) {
    return false;
  }

  state.recentProgrammaticSubmits.delete(fingerprint);
  return true;
}
