// Transport-only base64 codec for attachment chunks.
//
// base64 is the on-wire encoding for ATTACHMENT_APPEND_CHUNK and
// ATTACHMENT_READ_CHUNK ONLY. It is decoded back to raw bytes at both ends — a
// Blob/ArrayBuffer in IndexedDB (background) and reconstructed File parts
// (content) — and must never enter USER_SUBMIT / DELIVER_PROMPT, chrome.storage
// metadata, or debug logs. Keeping the codec in one module makes that boundary a
// single, auditable place instead of three drifting copies.

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const batchSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += batchSize) {
    const batch = bytes.subarray(offset, offset + batchSize);
    binary += String.fromCharCode(...batch);
  }

  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  return base64ToBytes(base64).buffer as ArrayBuffer;
}
