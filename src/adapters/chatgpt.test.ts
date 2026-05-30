// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatgptAdapter } from './chatgpt';
import { installFileInputDeliveryBridge } from '../content/file-input-delivery-main';

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

describe('ChatGPT attachment delivery adapter', () => {
  let rectSpy: ReturnType<typeof vi.spyOn>;
  let uninstallFileInputDeliveryBridge: () => void;

  beforeEach(() => {
    document.body.innerHTML = '';
    rectSpy = mockVisibleLayout();
    uninstallFileInputDeliveryBridge = installFileInputDeliveryBridge();
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
    uninstallFileInputDeliveryBridge();
    rectSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('sets text and injects reconstructed files through the scoped ChatGPT file input', async () => {
    document.body.innerHTML = `
      <form data-type="unified-composer">
        <input id="upload-files" type="file" multiple />
        <div id="prompt-textarea" role="textbox" aria-label="Chat with ChatGPT" contenteditable="true"></div>
        <button id="composer-submit-button" data-testid="send-button" aria-label="Send prompt"></button>
      </form>
    `;

    await chatgptAdapter.composer?.setComposerPayload?.({
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

    const input = document.getElementById('upload-files') as HTMLInputElement;
    expect(input.files?.[0]).toEqual(expect.any(File));
    expect(input.files?.[0]?.name).toBe('sample.pdf');
    expect(input.files?.[0]?.type).toBe('application/pdf');
    expect(document.getElementById('prompt-textarea')?.textContent).toBe('hello');
  });

  it('falls back to synthetic paste when no scoped file input exists', async () => {
    document.body.innerHTML = `
      <form data-type="unified-composer">
        <div id="prompt-textarea" role="textbox" aria-label="Chat with ChatGPT" contenteditable="true"></div>
        <button id="composer-submit-button" data-testid="send-button" aria-label="Send prompt"></button>
      </form>
    `;

    const composer = document.getElementById('prompt-textarea') as HTMLElement;
    let pastedFiles: File[] = [];
    composer.addEventListener('paste', (event) => {
      pastedFiles = Array.from((event as ClipboardEvent).clipboardData?.files ?? []);
    });

    await chatgptAdapter.composer?.setComposerPayload?.({
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

    expect(pastedFiles[0]).toEqual(expect.any(File));
    expect(pastedFiles[0]?.name).toBe('sample.pdf');
  });

  it('reports attachment presence from ChatGPT file tiles that show expected filenames', async () => {
    document.body.innerHTML = `
      <form data-type="unified-composer">
        <input id="upload-files" type="file" multiple />
        <div id="prompt-textarea" role="textbox" aria-label="Chat with ChatGPT" contenteditable="true"></div>
        <button id="composer-submit-button" data-testid="send-button" aria-label="Send prompt"></button>
        <div role="group" aria-label="notes.md" class="group/file-tile">
          <button type="button" aria-label="notes.md"></button>
          <div>
            <div>notes.md</div>
            <div>MD</div>
          </div>
          <button type="button" aria-label="Remove file 1: notes.md"></button>
        </div>
      </form>
    `;

    await expect(Promise.resolve(chatgptAdapter.composer?.getComposerAttachmentPresence?.([
      {
        id: 'a1',
        name: 'notes.md',
        mime: 'text/markdown',
        size: 3,
      },
    ]))).resolves.toMatchObject({
      count: 1,
      keys: expect.arrayContaining([expect.stringContaining('notes.md')]),
    });
  });

  it('keeps baseline attachment tiles scoped so old drafts do not satisfy a new delta', async () => {
    document.body.innerHTML = `
      <form data-type="unified-composer">
        <input id="upload-files" type="file" multiple />
        <div id="prompt-textarea" role="textbox" aria-label="Chat with ChatGPT" contenteditable="true"></div>
        <button id="composer-submit-button" data-testid="send-button" aria-label="Send prompt"></button>
        <div role="group" aria-label="old.pdf" class="group/file-tile">
          <div>old.pdf</div>
          <button type="button" aria-label="Remove file 1: old.pdf"></button>
        </div>
      </form>
    `;

    await expect(Promise.resolve(chatgptAdapter.composer?.getComposerAttachmentPresence?.([
      {
        id: 'a1',
        name: 'new.pdf',
        mime: 'application/pdf',
        size: 3,
      },
    ]))).resolves.toEqual({
      count: 0,
      keys: [],
    });
  });

  it('reads submit-time source attachment snapshots from ChatGPT file tiles', () => {
    document.body.innerHTML = `
      <form data-type="unified-composer">
        <input id="upload-files" type="file" multiple />
        <div id="prompt-textarea" role="textbox" aria-label="Chat with ChatGPT" contenteditable="true"></div>
        <div role="group" aria-label="kept.md" class="group/file-tile">
          <div>kept.md</div>
        </div>
      </form>
    `;

    expect(chatgptAdapter.composer?.getComposerAttachmentSnapshot?.([
      {
        id: 'a1',
        name: 'kept.md',
        mime: 'text/markdown',
        size: 3,
        source: 'file-input',
        file: new File(['abc'], 'kept.md', { type: 'text/markdown' }),
      },
    ])).toMatchObject({
      count: 1,
      items: [expect.stringContaining('kept.md')],
    });
  });

  it('uses generic image preview count for ChatGPT source snapshots when filenames are hidden', () => {
    document.body.innerHTML = `
      <form data-type="unified-composer">
        <input id="upload-files" type="file" multiple />
        <div id="prompt-textarea" role="textbox" aria-label="Chat with ChatGPT" contenteditable="true"></div>
        <div data-testid="composer-image-preview">
          <img alt="Uploaded image" src="blob:https://chatgpt.com/image-1" />
          <button type="button" aria-label="Remove attachment"></button>
        </div>
      </form>
    `;

    expect(chatgptAdapter.composer?.getComposerAttachmentSnapshot?.([
      {
        id: 'a1',
        name: 'gavin5.jpg',
        mime: 'image/jpeg',
        size: 3,
        source: 'paste',
        file: new File(['abc'], 'gavin5.jpg', { type: 'image/jpeg' }),
      },
    ])).toEqual({
      count: 1,
      items: [],
    });
  });

  it('fails closed for ChatGPT source snapshots when generic preview count differs from captured files', () => {
    document.body.innerHTML = `
      <form data-type="unified-composer">
        <input id="upload-files" type="file" multiple />
        <div id="prompt-textarea" role="textbox" aria-label="Chat with ChatGPT" contenteditable="true"></div>
        <div data-testid="composer-image-preview">
          <img alt="Uploaded image" src="blob:https://chatgpt.com/image-1" />
          <button type="button" aria-label="Remove attachment"></button>
        </div>
      </form>
    `;

    expect(chatgptAdapter.composer?.getComposerAttachmentSnapshot?.([
      {
        id: 'a1',
        name: 'one.jpg',
        mime: 'image/jpeg',
        size: 3,
        source: 'paste',
        file: new File(['abc'], 'one.jpg', { type: 'image/jpeg' }),
      },
      {
        id: 'a2',
        name: 'two.jpg',
        mime: 'image/jpeg',
        size: 3,
        source: 'paste',
        file: new File(['def'], 'two.jpg', { type: 'image/jpeg' }),
      },
    ])).toEqual({
      count: 1,
      items: [],
    });
  });

  it('detects ChatGPT upload failure messaging', async () => {
    document.body.innerHTML = `
      <form data-type="unified-composer">
        <div id="prompt-textarea" role="textbox" aria-label="Chat with ChatGPT" contenteditable="true"></div>
      </form>
      <div role="alert">Failed to upload sample.pdf</div>
    `;

    await expect(Promise.resolve(chatgptAdapter.composer?.detectAttachmentUploadError?.())).resolves.toBe('upload failed');
  });
});
