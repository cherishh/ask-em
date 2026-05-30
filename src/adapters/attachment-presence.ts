import type { ComposerAttachmentPresence } from './types';

export function countAttachmentPresenceDelta(
  baseline: ComposerAttachmentPresence,
  current: ComposerAttachmentPresence,
): number {
  const countDelta = current.count - baseline.count;

  if (baseline.keys && current.keys) {
    const baselineKeys = new Set(baseline.keys);
    const keyDelta = current.keys.filter((key) => !baselineKeys.has(key)).length;
    return Math.max(countDelta, keyDelta);
  }

  return countDelta;
}
