import { describe, expect, it } from 'vitest';
import { checkProviderAttachmentCapability } from './attachment-capability';

describe('provider attachment capability gate', () => {
  it('lets providers decide attachment file types', () => {
    expect(
      checkProviderAttachmentCapability('claude', [
        { id: 'a1', name: 'sample.pdf', mime: 'application/pdf', size: 100 },
        { id: 'a2', name: 'archive.zip', mime: 'application/zip', size: 100 },
        { id: 'a3', name: 'movie.mp4', mime: 'video/mp4', size: 100 },
        { id: 'a4', name: 'extensionless', mime: '', size: 100 },
      ]),
    ).toEqual({ ok: true });
  });

  it('rejects providers without attachment support', () => {
    expect(
      checkProviderAttachmentCapability(
        'deepseek',
        [
          {
            id: 'a1',
            name: 'anything.bin',
            mime: 'application/octet-stream',
            size: 100,
          },
        ],
        null,
      ),
    ).toEqual({
      ok: false,
      reason: 'deepseek attachment not supported',
    });
  });

  it('lets Kimi accept attachments within the shared transport cap', () => {
    expect(
      checkProviderAttachmentCapability('kimi', [
        { id: 'a1', name: 'anything.png', mime: 'image/png', size: 100 },
      ]),
    ).toEqual({ ok: true });
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

  it('rejects Manus multi-file batches on the free-plan target cap', () => {
    expect(
      checkProviderAttachmentCapability('manus', [
        { id: 'a1', name: 'one.txt', mime: 'text/plain', size: 1 },
        { id: 'a2', name: 'two.txt', mime: 'text/plain', size: 1 },
      ]),
    ).toEqual({
      ok: false,
      reason: 'manus attachment count not supported',
    });
  });
});
