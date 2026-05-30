import type { DebugLogEntry } from './types';

export const DEBUG_LOG_MAX_ENTRIES = 500;
export const DEBUG_LOG_MAX_BYTES = 512 * 1024;
export const DEBUG_LOG_MESSAGE_MAX_BYTES = 2 * 1024;
export const DEBUG_LOG_DETAIL_MAX_BYTES = 8 * 1024;
export const FEEDBACK_DEBUG_LOG_MAX_BYTES = 256 * 1024;

type DebugLogRetentionLimits = {
  maxEntries: number;
  maxBytes: number;
  maxMessageBytes: number;
  maxDetailBytes: number;
};

const DEFAULT_DEBUG_LOG_LIMITS: DebugLogRetentionLimits = {
  maxEntries: DEBUG_LOG_MAX_ENTRIES,
  maxBytes: DEBUG_LOG_MAX_BYTES,
  maxMessageBytes: DEBUG_LOG_MESSAGE_MAX_BYTES,
  maxDetailBytes: DEBUG_LOG_DETAIL_MAX_BYTES,
};

const textEncoder = new TextEncoder();

export function getUtf8ByteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function takePrefixByBytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return '';
  }

  let bytes = 0;
  let result = '';

  for (const char of value) {
    const charBytes = getUtf8ByteLength(char);
    if (bytes + charBytes > maxBytes) {
      break;
    }

    bytes += charBytes;
    result += char;
  }

  return result;
}

function takeSuffixByBytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return '';
  }

  let bytes = 0;
  let result = '';
  const chars = Array.from(value);

  for (let index = chars.length - 1; index >= 0; index -= 1) {
    const char = chars[index];
    const charBytes = getUtf8ByteLength(char);
    if (bytes + charBytes > maxBytes) {
      break;
    }

    bytes += charBytes;
    result = char + result;
  }

  return result;
}

export function truncateUtf8Middle(value: string, maxBytes: number): string {
  const originalBytes = getUtf8ByteLength(value);

  if (originalBytes <= maxBytes) {
    return value;
  }

  if (maxBytes <= 0) {
    return '';
  }

  let omittedBytes = originalBytes;
  let truncated = '';

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const marker = `...[truncated ${omittedBytes} bytes]...`;
    const markerBytes = getUtf8ByteLength(marker);

    if (markerBytes >= maxBytes) {
      return takePrefixByBytes(marker, maxBytes);
    }

    const remainingBytes = maxBytes - markerBytes;
    const head = takePrefixByBytes(value, Math.ceil(remainingBytes / 2));
    const tail = takeSuffixByBytes(value, Math.floor(remainingBytes / 2));
    const nextOmittedBytes = originalBytes - getUtf8ByteLength(head) - getUtf8ByteLength(tail);
    truncated = `${head}${marker}${tail}`;

    if (nextOmittedBytes === omittedBytes && getUtf8ByteLength(truncated) <= maxBytes) {
      return truncated;
    }

    omittedBytes = nextOmittedBytes;
  }

  return getUtf8ByteLength(truncated) <= maxBytes
    ? truncated
    : takePrefixByBytes(truncated, maxBytes);
}

function normalizeDebugLogEntry(
  entry: DebugLogEntry,
  limits: DebugLogRetentionLimits,
): DebugLogEntry {
  const message = truncateUtf8Middle(entry.message, limits.maxMessageBytes);
  const detail = entry.detail === undefined
    ? undefined
    : truncateUtf8Middle(entry.detail, limits.maxDetailBytes);

  if (message === entry.message && detail === entry.detail) {
    return entry;
  }

  return {
    ...entry,
    message,
    detail,
  };
}

export function getDebugLogsByteLength(logs: DebugLogEntry[]): number {
  return getUtf8ByteLength(JSON.stringify(logs));
}

function trimDebugLogs(
  logs: DebugLogEntry[],
  limits: DebugLogRetentionLimits,
): DebugLogEntry[] {
  let nextLogs = logs;

  for (let index = 0; index < logs.length; index += 1) {
    const normalized = normalizeDebugLogEntry(logs[index], limits);

    if (normalized !== logs[index]) {
      if (nextLogs === logs) {
        nextLogs = logs.slice();
      }
      nextLogs[index] = normalized;
    }
  }

  if (nextLogs.length > limits.maxEntries) {
    nextLogs = nextLogs.slice(-limits.maxEntries);
  }

  while (nextLogs.length > 0 && getDebugLogsByteLength(nextLogs) > limits.maxBytes) {
    nextLogs = nextLogs.slice(1);
  }

  return nextLogs;
}

export function trimDebugLogsForStorage(logs: DebugLogEntry[]): DebugLogEntry[] {
  return trimDebugLogs(logs, DEFAULT_DEBUG_LOG_LIMITS);
}

export function trimDebugLogsForFeedback(logs: DebugLogEntry[]): DebugLogEntry[] {
  return trimDebugLogs(logs, {
    ...DEFAULT_DEBUG_LOG_LIMITS,
    maxBytes: FEEDBACK_DEBUG_LOG_MAX_BYTES,
  });
}
