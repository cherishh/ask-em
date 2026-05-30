// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { geminiAdapter } from './gemini';

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

describe('Gemini attachment delivery adapter', () => {
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

  it('sets text and injects reconstructed files through synthetic paste', async () => {
    document.body.innerHTML = `
      <div class="text-input-field">
        <rich-textarea>
          <div class="ql-editor textarea" role="textbox" aria-label="Enter a prompt for Gemini" contenteditable="true"></div>
        </rich-textarea>
        <button aria-label="Send message"></button>
      </div>
    `;

    const composer = document.querySelector<HTMLElement>('.ql-editor');
    let pastedFiles: File[] = [];
    composer?.addEventListener('paste', (event) => {
      pastedFiles = Array.from((event as ClipboardEvent).clipboardData?.files ?? []);
    });

    await geminiAdapter.composer?.setComposerPayload?.({
      text: 'hello',
      attachments: [
        {
          id: 'a1',
          name: 'notes.md',
          mime: 'text/markdown',
          size: 3,
        },
      ],
    });

    expect(composer?.textContent).toBe('hello');
    expect(pastedFiles[0]).toEqual(expect.any(File));
    expect(pastedFiles[0]?.name).toBe('notes.md');
  });

  it('reports attachment presence from Gemini file preview chips', async () => {
    document.body.innerHTML = `
      <div class="text-input-field with-file-preview">
        <div class="attachment-preview-wrapper">
          <uploader-file-preview class="file-preview-chip">
            <gem-attachment class="gem-attachment gds-label-l gem-attachment-tile">
              <span class="gem-attachment-text">notes.md</span>
              <button aria-label="close notes.md"></button>
            </gem-attachment>
          </uploader-file-preview>
          <uploader-file-preview class="file-preview-chip">
            <gem-attachment class="gem-attachment gds-label-l gem-attachment-tile">
              <span class="gem-attachment-text">brief.pdf</span>
              <button aria-label="close brief.pdf"></button>
            </gem-attachment>
          </uploader-file-preview>
        </div>
        <div class="ql-editor textarea" role="textbox" aria-label="Enter a prompt for Gemini" contenteditable="true"></div>
        <button aria-label="Send message"></button>
      </div>
    `;

    await expect(Promise.resolve(geminiAdapter.composer?.getComposerAttachmentPresence?.([
      {
        id: 'a1',
        name: 'notes.md',
        mime: 'text/markdown',
        size: 3,
      },
      {
        id: 'a2',
        name: 'brief.pdf',
        mime: 'application/pdf',
        size: 4,
      },
    ]))).resolves.toMatchObject({
      count: 2,
      keys: expect.arrayContaining([
        expect.stringContaining('notes.md'),
        expect.stringContaining('brief.pdf'),
      ]),
    });
  });

  it('keeps old Gemini draft attachments from satisfying a new expected file', async () => {
    document.body.innerHTML = `
      <div class="text-input-field with-file-preview">
        <div class="attachment-preview-wrapper">
          <uploader-file-preview class="file-preview-chip">
            <gem-attachment class="gem-attachment gds-label-l gem-attachment-tile">
              <span class="gem-attachment-text">old.pdf</span>
            </gem-attachment>
          </uploader-file-preview>
        </div>
        <div class="ql-editor textarea" role="textbox" aria-label="Enter a prompt for Gemini" contenteditable="true"></div>
        <button aria-label="Send message"></button>
      </div>
    `;

    await expect(Promise.resolve(geminiAdapter.composer?.getComposerAttachmentPresence?.([
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

  it('reads submit-time source attachment snapshots from Gemini file previews', () => {
    document.body.innerHTML = `
      <div class="text-input-field with-file-preview">
        <div class="attachment-preview-wrapper">
          <uploader-file-preview class="file-preview-chip">
            <gem-attachment class="gem-attachment gds-label-l gem-attachment-tile">
              <span class="gem-attachment-text">kept.md</span>
            </gem-attachment>
          </uploader-file-preview>
        </div>
        <div class="ql-editor textarea" role="textbox" aria-label="Enter a prompt for Gemini" contenteditable="true"></div>
      </div>
    `;

    expect(geminiAdapter.composer?.getComposerAttachmentSnapshot?.([
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

  it('captures Gemini transient upload files before submit when the current preview is present', () => {
    document.body.innerHTML = `
      <div class="text-input-field with-file-preview">
        <div class="attachment-preview-wrapper">
          <uploader-file-preview class="file-preview-chip">
            <gem-attachment class="gem-attachment gds-label-l gem-attachment-tile">
              <span class="gem-attachment-text">upload</span>
            </gem-attachment>
          </uploader-file-preview>
        </div>
        <div class="ql-editor textarea" role="textbox" aria-label="Enter a prompt for Gemini" contenteditable="true">hello</div>
        <button aria-label="Send message"></button>
      </div>
    `;

    const file = new File(['abc'], 'upload.md', { type: 'text/markdown' });
    const onSubmit = vi.fn();
    const unsubscribe = geminiAdapter.composer?.subscribeToUserSubmissions?.(onSubmit);
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          source: 'ask-em',
          type: 'ASK_EM_TRANSIENT_FILES',
          files: [file],
        },
      }),
    );
    document.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello',
      attachments: [
        expect.objectContaining({
          file,
          name: 'upload.md',
          mime: 'text/markdown',
          source: 'transient-file-input',
        }),
      ],
      attachmentResolution: expect.objectContaining({
        capturedCount: 1,
        currentCount: 1,
        submittedCount: 1,
      }),
    }));
    unsubscribe?.();
  });

  it('matches extensionless Gemini preview text back to the captured filename', () => {
    document.body.innerHTML = `
      <div class="text-input-field with-file-preview">
        <div class="attachment-preview-wrapper">
          <uploader-file-preview class="file-preview-chip">
            <gem-attachment class="gem-attachment gds-label-l gem-attachment-tile">
              <span class="gem-attachment-text">report</span>
              <button aria-label="close report"></button>
            </gem-attachment>
          </uploader-file-preview>
        </div>
        <div class="ql-editor textarea" role="textbox" aria-label="Enter a prompt for Gemini" contenteditable="true"></div>
      </div>
    `;

    expect(geminiAdapter.composer?.getComposerAttachmentSnapshot?.([
      {
        id: 'a1',
        name: 'report.md',
        mime: 'text/markdown',
        size: 3,
        source: 'transient-file-input',
        file: new File(['abc'], 'report.md', { type: 'text/markdown' }),
      },
    ])).toMatchObject({
      count: 1,
      items: ['report.md'],
    });
  });

  it('detects Gemini upload failure messaging', async () => {
    document.body.innerHTML = `
      <div class="text-input-field">
        <div class="ql-editor textarea" role="textbox" aria-label="Enter a prompt for Gemini" contenteditable="true"></div>
      </div>
      <div class="mat-mdc-snack-bar-container">Failed to upload sample.pdf</div>
    `;

    await expect(Promise.resolve(geminiAdapter.composer?.detectAttachmentUploadError?.())).resolves.toBe('upload failed');
  });
});
