// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claudeAdapter } from './claude';

function mockVisibleLayout() {
  return vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(() => ({
      width: 160,
      height: 36,
      top: 0,
      left: 0,
      right: 160,
      bottom: 36,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    }));
}

describe('Claude attachment delivery adapter', () => {
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    document.body.innerHTML = '';
    rectSpy = mockVisibleLayout();
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn(async () => ({
          ok: true,
          chunk: {
            attachmentId: 'a1',
            offset: 0,
            nextOffset: 3,
            chunkBase64: 'YWJj',
            done: true,
          },
        })),
      },
    });
  });

  afterEach(() => {
    rectSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('sets text and injects reconstructed files through Claude file input', async () => {
    document.body.innerHTML = `
      <form>
        <div data-testid="chat-input" contenteditable="true"></div>
        <input id="file" type="file" />
      </form>
    `;

    await claudeAdapter.composer?.setComposerPayload?.({
      text: 'hello',
      attachments: [
        {
          id: 'a1',
          name: 'sample.pdf',
          mime: 'application/pdf',
          size: 3,
        },
      ],
    });

    const input = document.getElementById('file') as HTMLInputElement;
    expect(input.files?.[0]).toEqual(expect.any(File));
    expect(input.files?.[0]?.name).toBe('sample.pdf');
    expect(input.files?.[0]?.type).toBe('application/pdf');
    expect(document.querySelector('[data-testid="chat-input"]')?.textContent).toBe('hello');
  });

  it('reports attachment presence from Claude attachment controls', async () => {
    document.body.innerHTML = `
      <form>
        <div data-testid="chat-input" contenteditable="true"></div>
        <button aria-label="Remove sample.pdf attachment"></button>
      </form>
    `;

    await expect(Promise.resolve(claudeAdapter.composer?.getComposerAttachmentPresence?.())).resolves.toEqual({
      count: 1,
      keys: ['Remove sample.pdf attachment'],
    });
  });
});
