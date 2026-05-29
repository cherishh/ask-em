import { beforeEach, describe, expect, it, vi } from 'vitest';

const attachmentStoreMocks = vi.hoisted(() => ({
  abortAttachments: vi.fn().mockResolvedValue(undefined),
  appendAttachmentChunk: vi.fn().mockResolvedValue(undefined),
  createAttachment: vi.fn().mockResolvedValue({
    id: 'a1',
    name: 'a.png',
    mime: 'image/png',
    size: 1,
  }),
  finalizeAttachment: vi.fn().mockResolvedValue({
    id: 'a1',
    name: 'a.png',
    mime: 'image/png',
    size: 1,
  }),
  readAttachmentChunk: vi.fn().mockResolvedValue({
    attachmentId: 'a1',
    offset: 0,
    nextOffset: 1,
    chunkBase64: 'AA==',
    done: true,
  }),
}));

vi.mock('../runtime/attachment-store', () => attachmentStoreMocks);

describe('attachment message handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('derives attachment owner tab from the sender instead of message payload', async () => {
    const { handleAttachmentMessage } = await import('./attachment-messages');

    const response = await handleAttachmentMessage(
      {
        type: 'ATTACHMENT_CREATE',
        submitId: 'submit-1',
        id: 'a1',
        name: 'a.png',
        mime: 'image/png',
        size: 1,
      },
      { tab: { id: 9 } } as chrome.runtime.MessageSender,
    );

    expect(response).toEqual({
      ok: true,
      ref: {
        id: 'a1',
        name: 'a.png',
        mime: 'image/png',
        size: 1,
      },
    });
    expect(attachmentStoreMocks.createAttachment).toHaveBeenCalledWith({
      submitId: 'submit-1',
      ref: {
        id: 'a1',
        name: 'a.png',
        mime: 'image/png',
        size: 1,
      },
      ownerTabId: 9,
    });
  });

  it('returns structured errors for rejected attachment commands', async () => {
    attachmentStoreMocks.appendAttachmentChunk.mockRejectedValueOnce(new Error('bad chunk'));

    const { handleAttachmentMessage } = await import('./attachment-messages');
    const response = await handleAttachmentMessage(
      {
        type: 'ATTACHMENT_APPEND_CHUNK',
        submitId: 'submit-1',
        attachmentId: 'a1',
        offset: 0,
        chunkBase64: 'AA==',
      },
      { tab: { id: 9 } } as chrome.runtime.MessageSender,
    );

    expect(response).toEqual({
      ok: false,
      error: 'bad chunk',
    });
  });
});
