import { describe, expect, it } from 'vitest';
import { checkProviderAttachmentCapability } from './attachment-capability';

describe('provider attachment capability gate', () => {
  it('allows supported MIME types', () => {
    expect(
      checkProviderAttachmentCapability('claude', [
        { id: 'a1', name: 'sample.pdf', mime: 'application/pdf', size: 100 },
        {
          id: 'a2',
          name: 'notes.docx',
          mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size: 100,
        },
      ]),
    ).toEqual({ ok: true });
  });

  it('uses document extension fallback even when MIME is generic or vendor-specific', () => {
    expect(
      checkProviderAttachmentCapability('chatgpt', [
        { id: 'a1', name: 'sample.pdf', mime: 'application/octet-stream', size: 100 },
      ]),
    ).toEqual({ ok: true });

    expect(
      checkProviderAttachmentCapability('chatgpt', [
        { id: 'a1', name: 'sample.pdf', mime: 'application/x-custom', size: 100 },
      ]),
    ).toEqual({ ok: true });
  });

  it('allows source-confirmed plain text even for code and config files', () => {
    expect(
      checkProviderAttachmentCapability('claude', [
        { id: 'a1', name: '.env', mime: 'application/octet-stream', size: 100, isPlainText: true },
        { id: 'a2', name: 'component.tsx', mime: 'application/x-custom', size: 100, isPlainText: true },
      ]),
    ).toEqual({ ok: true });
  });

  it('allows text MIME and extension fallbacks when source sniffing is unavailable', () => {
    expect(
      checkProviderAttachmentCapability('claude', [
        { id: 'a1', name: 'settings.conf', mime: 'application/octet-stream', size: 100 },
        { id: 'a2', name: 'payload', mime: 'application/json', size: 100 },
      ]),
    ).toEqual({ ok: true });
  });

  it('rejects empty MIME and missing extension unless source confirmed plain text', () => {
    expect(
      checkProviderAttachmentCapability('gemini', [
        { id: 'a1', name: 'clipboard-file', mime: '', size: 100 },
      ]),
    ).toEqual({
      ok: false,
      reason: 'gemini attachment type not supported',
    });
  });

  it('rejects blacklisted media and binary batches all-or-nothing', () => {
    expect(
      checkProviderAttachmentCapability('deepseek', [
        { id: 'a1', name: 'ok.png', mime: 'image/png', size: 100 },
        { id: 'a2', name: 'bad.zip', mime: 'application/zip', size: 100 },
      ]),
    ).toEqual({
      ok: false,
      reason: 'deepseek attachment type not supported',
    });

    expect(
      checkProviderAttachmentCapability('deepseek', [
        { id: 'a1', name: 'movie.mp4', mime: 'video/mp4', size: 100, isPlainText: true },
      ]),
    ).toEqual({
      ok: false,
      reason: 'deepseek attachment type not supported',
    });
  });

  it('rejects provider-specific count overage', () => {
    const attachments = Array.from({ length: 11 }, (_, index) => ({
      id: `a${index}`,
      name: `${index}.png`,
      mime: 'image/png',
      size: 1,
    }));

    expect(checkProviderAttachmentCapability('gemini', attachments)).toEqual({
      ok: false,
      reason: 'gemini attachment count not supported',
    });
  });
});
