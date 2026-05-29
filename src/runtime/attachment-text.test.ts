import { describe, expect, it } from 'vitest';
import { isProbablyPlainTextBytes } from './attachment-text';

const encoder = new TextEncoder();

describe('plain text attachment sniffing', () => {
  it('accepts utf-8 source and config files', () => {
    expect(isProbablyPlainTextBytes(encoder.encode('const value = 1;\nexport default value;\n'))).toBe(true);
    expect(isProbablyPlainTextBytes(encoder.encode('DATABASE_URL=postgres://example\n'))).toBe(true);
  });

  it('accepts empty files', () => {
    expect(isProbablyPlainTextBytes(new Uint8Array())).toBe(true);
  });

  it('rejects binary payloads with NUL bytes or invalid utf-8', () => {
    expect(isProbablyPlainTextBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]))).toBe(false);
    expect(isProbablyPlainTextBytes(new Uint8Array([0xff, 0xfd, 0xfc]))).toBe(false);
  });
});
