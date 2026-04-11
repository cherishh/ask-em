import { appendDebugLog } from '../runtime/storage';
import type { DebugLogEntry } from '../runtime/protocol';

export async function logDebug(
  entry: Omit<DebugLogEntry, 'id' | 'timestamp'> & Partial<Pick<DebugLogEntry, 'id' | 'timestamp'>>,
) {
  await appendDebugLog(entry);
}
