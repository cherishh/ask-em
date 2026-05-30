import { describe, expect, it } from 'vitest';
import type { DebugLogEntry } from './protocol';
import {
  DEBUG_LOG_DETAIL_MAX_BYTES,
  DEBUG_LOG_MAX_BYTES,
  DEBUG_LOG_MAX_ENTRIES,
  FEEDBACK_DEBUG_LOG_MAX_BYTES,
  getDebugLogsByteLength,
  getUtf8ByteLength,
  trimDebugLogsForFeedback,
  trimDebugLogsForStorage,
  truncateUtf8Middle,
} from './debug-log-retention';

function createLog(id: number, detail = 'detail'): DebugLogEntry {
  return {
    id: `log-${id}`,
    timestamp: id,
    level: 'info',
    scope: 'background',
    message: `message-${id}`,
    detail,
  };
}

describe('debug log retention', () => {
  it('truncates long strings in the middle while preserving both edges', () => {
    const value = `${'a'.repeat(100)}${'b'.repeat(100)}${'c'.repeat(100)}`;
    const truncated = truncateUtf8Middle(value, 80);

    expect(getUtf8ByteLength(truncated)).toBeLessThanOrEqual(80);
    expect(truncated.startsWith('a')).toBe(true);
    expect(truncated.endsWith('c')).toBe(true);
    expect(truncated).toContain('...[truncated ');
  });

  it('keeps only the newest entries when the entry count exceeds the storage cap', () => {
    const logs = Array.from({ length: DEBUG_LOG_MAX_ENTRIES + 25 }, (_, index) => createLog(index));
    const trimmed = trimDebugLogsForStorage(logs);

    expect(trimmed).toHaveLength(DEBUG_LOG_MAX_ENTRIES);
    expect(trimmed[0].id).toBe('log-25');
    expect(trimmed.at(-1)?.id).toBe(`log-${DEBUG_LOG_MAX_ENTRIES + 24}`);
  });

  it('truncates oversized entries and drops oldest logs until the storage budget fits', () => {
    const logs = Array.from({ length: 90 }, (_, index) =>
      createLog(index, `${index}:${'x'.repeat(DEBUG_LOG_DETAIL_MAX_BYTES * 2)}`),
    );
    const trimmed = trimDebugLogsForStorage(logs);

    expect(getDebugLogsByteLength(trimmed)).toBeLessThanOrEqual(DEBUG_LOG_MAX_BYTES);
    expect(trimmed.length).toBeLessThan(logs.length);
    expect(trimmed.at(-1)?.id).toBe('log-89');
    expect(trimmed.at(-1)?.detail).toContain('...[truncated ');
    expect(getUtf8ByteLength(trimmed.at(-1)?.detail ?? '')).toBeLessThanOrEqual(DEBUG_LOG_DETAIL_MAX_BYTES);
  });

  it('uses a smaller tail budget for feedback payloads', () => {
    const logs = Array.from({ length: 90 }, (_, index) =>
      createLog(index, `${index}:${'x'.repeat(DEBUG_LOG_DETAIL_MAX_BYTES * 2)}`),
    );
    const storageLogs = trimDebugLogsForStorage(logs);
    const feedbackLogs = trimDebugLogsForFeedback(logs);

    expect(getDebugLogsByteLength(storageLogs)).toBeLessThanOrEqual(DEBUG_LOG_MAX_BYTES);
    expect(getDebugLogsByteLength(feedbackLogs)).toBeLessThanOrEqual(FEEDBACK_DEBUG_LOG_MAX_BYTES);
    expect(feedbackLogs.length).toBeLessThan(storageLogs.length);
    expect(feedbackLogs.at(-1)?.id).toBe('log-89');
  });
});
