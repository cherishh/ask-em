import { describe, expect, it } from 'vitest';
import {
  isSubmissionSuppressed,
  suppressObservedSubmissions,
} from './submit-suppression';

describe('submit-suppression', () => {
  it('suppresses submits until the window expires', () => {
    const state = { suppressSubmissionsUntil: 0 };

    suppressObservedSubmissions(state, 2_500, 1_000);
    expect(isSubmissionSuppressed(state, 1_100)).toBe(true);
    expect(isSubmissionSuppressed(state, 3_499)).toBe(true);
    expect(isSubmissionSuppressed(state, 3_500)).toBe(false);
  });
});
