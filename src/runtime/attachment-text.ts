const TEXT_SNIFF_BYTES = 64 * 1024;
const MAX_CONTROL_CHARACTER_RATIO = 0.01;

function hasUtf16Bom(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 2 &&
    ((bytes[0] === 0xff && bytes[1] === 0xfe) ||
      (bytes[0] === 0xfe && bytes[1] === 0xff))
  );
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

function isAllowedTextControlCharacter(codePoint: number): boolean {
  return codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0c || codePoint === 0x0d;
}

export function isProbablyPlainTextBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength === 0) {
    return true;
  }

  const sample = bytes.subarray(0, Math.min(bytes.byteLength, TEXT_SNIFF_BYTES));
  if (hasUtf16Bom(sample)) {
    return true;
  }

  if (sample.includes(0)) {
    return false;
  }

  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(
      hasUtf8Bom(sample) ? sample.subarray(3) : sample,
    );
  } catch {
    return false;
  }

  if (decoded.length === 0) {
    return true;
  }

  let controlCharacters = 0;
  for (const character of decoded) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x20 && !isAllowedTextControlCharacter(codePoint)) {
      controlCharacters += 1;
    }
  }

  return controlCharacters / decoded.length <= MAX_CONTROL_CHARACTER_RATIO;
}
