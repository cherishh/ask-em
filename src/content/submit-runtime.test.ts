import { describe, expect, it } from 'vitest';
import {
  createInitialSubmitRuntime,
  isSubmitRuntimeSuppressed,
  rememberProgrammaticSubmitInRuntime,
  rememberSubmitFingerprintInRuntime,
  shouldSkipDuplicateSubmitInRuntime,
  shouldSuppressProgrammaticSubmitInRuntime,
  suppressSubmitRuntime,
} from './submit-runtime';

describe('submit-runtime', () => {
  it('tracks suppression windows', () => {
    const runtime = createInitialSubmitRuntime();

    suppressSubmitRuntime(runtime, 2_500, 100);
    expect(isSubmitRuntimeSuppressed(runtime, 101)).toBe(true);
    expect(isSubmitRuntimeSuppressed(runtime, 2_600)).toBe(false);
  });

  it('tracks recent programmatic submits', () => {
    const runtime = createInitialSubmitRuntime();

    rememberProgrammaticSubmitInRuntime(runtime, 'hello', 1_000);
    expect(shouldSuppressProgrammaticSubmitInRuntime(runtime, 'hello', 1_001)).toBe(true);
    expect(shouldSuppressProgrammaticSubmitInRuntime(runtime, 'hello', 1_002)).toBe(false);
  });

  it('tracks duplicate submit fingerprints', () => {
    const runtime = createInitialSubmitRuntime();

    rememberSubmitFingerprintInRuntime(runtime, 'u::hello', 1_000);
    expect(shouldSkipDuplicateSubmitInRuntime(runtime, 'u::hello', 1_001)).toBe(true);
    expect(shouldSkipDuplicateSubmitInRuntime(runtime, 'u::hello', 4_001)).toBe(false);
  });
});
