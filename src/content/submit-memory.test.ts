import { describe, expect, it } from 'vitest';
import {
  rememberProgrammaticSubmit,
  shouldSuppressProgrammaticSubmit,
} from './submit-memory';
import {
  rememberSubmitFingerprint,
  shouldSkipDuplicateSubmit,
} from './submit-fingerprint';

describe('content submit memory helpers', () => {
  it('suppresses a remembered programmatic submit once', () => {
    const state = {
      recentProgrammaticSubmits: new Map<string, number>(),
    };

    rememberProgrammaticSubmit(state, 'hello', 100);

    expect(shouldSuppressProgrammaticSubmit(state, 'hello', 101)).toBe(true);
    expect(shouldSuppressProgrammaticSubmit(state, 'hello', 102)).toBe(false);
  });

  it('expires remembered programmatic submits after the TTL window', () => {
    const state = {
      recentProgrammaticSubmits: new Map<string, number>(),
    };

    rememberProgrammaticSubmit(state, 'hello', 100);

    expect(shouldSuppressProgrammaticSubmit(state, 'hello', 30_101)).toBe(false);
  });

  it('skips duplicate submit fingerprints inside the dedupe window', () => {
    const state = {
      lastFingerprint: '',
      lastFingerprintAt: 0,
    };

    rememberSubmitFingerprint(state, 'u1::hello', 100);

    expect(shouldSkipDuplicateSubmit(state, 'u1::hello', 200)).toBe(true);
    expect(shouldSkipDuplicateSubmit(state, 'u1::hello', 1_700)).toBe(false);
    expect(shouldSkipDuplicateSubmit(state, 'u2::hello', 200)).toBe(false);
  });
});
