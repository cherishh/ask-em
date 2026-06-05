// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { geminiAdapter } from './gemini';

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

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
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout'],
    });
    try {
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
        document.querySelector('.text-input-field')?.insertAdjacentHTML('afterbegin', `
          <uploader-file-preview class="file-preview-chip">
            <gem-attachment class="gem-attachment gds-label-l gem-attachment-tile">
              <span class="gem-attachment-text">notes.md</span>
            </gem-attachment>
          </uploader-file-preview>
        `);
      });

      const delivery = geminiAdapter.composer?.setComposerPayload?.({
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
      await flushMicrotasks();
      expect(composer?.textContent).not.toContain('hello');
      await vi.advanceTimersByTimeAsync(5_250);
      await delivery;

      expect(composer?.textContent).toBe('hello');
      expect(pastedFiles[0]).toEqual(expect.any(File));
      expect(pastedFiles[0]?.name).toBe('notes.md');
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for attachment-only submit readiness before writing prompt text', async () => {
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout'],
    });
    try {
      document.body.innerHTML = `
        <div class="text-input-field">
          <rich-textarea>
            <div class="ql-editor textarea" role="textbox" aria-label="Enter a prompt for Gemini" contenteditable="true"></div>
          </rich-textarea>
          <button aria-label="Send message" disabled></button>
        </div>
      `;

      const composer = document.querySelector<HTMLElement>('.ql-editor');
      const sendButton = document.querySelector<HTMLButtonElement>('button[aria-label="Send message"]');
      composer?.addEventListener('paste', () => {
        document.querySelector('.text-input-field')?.insertAdjacentHTML('afterbegin', `
          <uploader-file-preview class="file-preview-chip">
            <gem-attachment class="gem-attachment gds-label-l gem-attachment-tile">
              <span class="gem-attachment-text">notes.md</span>
            </gem-attachment>
          </uploader-file-preview>
        `);
      });

      const delivery = geminiAdapter.composer?.setComposerPayload?.({
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

      await flushMicrotasks();
      expect(composer?.textContent).not.toContain('hello');

      sendButton?.removeAttribute('disabled');
      await vi.advanceTimersByTimeAsync(250);
      expect(composer?.textContent).not.toContain('hello');
      await vi.advanceTimersByTimeAsync(5_000);
      await delivery;

      expect(composer?.textContent).toContain('hello');
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the localized Gemini send button enabled state from the host element', async () => {
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout'],
    });
    try {
      document.body.innerHTML = `
        <div class="text-input-field">
          <rich-textarea>
            <div class="ql-editor textarea new-input-ui" role="textbox" aria-label="为 Gemini 输入提示" contenteditable="true"></div>
          </rich-textarea>
          <gem-icon-button class="send-button submit" aria-disabled="true">
            <button aria-label="发送"></button>
          </gem-icon-button>
        </div>
      `;

      const composer = document.querySelector<HTMLElement>('.ql-editor');
      const sendHost = document.querySelector<HTMLElement>('gem-icon-button.send-button');
      composer?.addEventListener('paste', () => {
        document.querySelector('.text-input-field')?.insertAdjacentHTML('afterbegin', `
          <uploader-file-preview class="file-preview-chip">
            <gem-attachment class="gem-attachment gds-label-l gem-attachment-tile">
              <span class="gem-attachment-text">notes.md</span>
            </gem-attachment>
          </uploader-file-preview>
        `);
      });

      const delivery = geminiAdapter.composer?.setComposerPayload?.({
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

      await flushMicrotasks();
      expect(composer?.textContent).not.toContain('hello');

      await vi.advanceTimersByTimeAsync(5_250);
      expect(composer?.textContent).not.toContain('hello');

      sendHost?.setAttribute('aria-disabled', 'false');
      await vi.advanceTimersByTimeAsync(5_250);
      await delivery;

      expect(composer?.textContent).toContain('hello');
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses a Gemini attachment baseline so existing matching drafts do not release prompt text early', async () => {
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout'],
    });
    try {
      document.body.innerHTML = `
        <div class="text-input-field">
          <uploader-file-preview class="file-preview-chip">
            <gem-attachment class="gem-attachment gds-label-l gem-attachment-tile">
              <span class="gem-attachment-text">notes.md</span>
            </gem-attachment>
          </uploader-file-preview>
          <rich-textarea>
            <div class="ql-editor textarea" role="textbox" aria-label="Enter a prompt for Gemini" contenteditable="true"></div>
          </rich-textarea>
          <button aria-label="Send message"></button>
        </div>
      `;

      const composer = document.querySelector<HTMLElement>('.ql-editor');
      composer?.addEventListener('paste', () => {
        window.setTimeout(() => {
          document.querySelector('.text-input-field')?.insertAdjacentHTML('afterbegin', `
            <uploader-file-preview class="file-preview-chip">
              <gem-attachment class="gem-attachment gds-label-l gem-attachment-tile">
                <span class="gem-attachment-text">notes.md</span>
              </gem-attachment>
            </uploader-file-preview>
          `);
        }, 250);
      });

      const delivery = geminiAdapter.composer?.setComposerPayload?.({
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

      await flushMicrotasks();
      expect(composer?.textContent).not.toContain('hello');

      await vi.advanceTimersByTimeAsync(250);
      expect(composer?.textContent).not.toContain('hello');
      await vi.advanceTimersByTimeAsync(5_000);
      await delivery;

      expect(composer?.textContent).toContain('hello');
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits past 30 seconds for slow existing-session Gemini attachment readiness', async () => {
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout'],
    });
    try {
      document.body.innerHTML = `
        <div class="text-input-field">
          <rich-textarea>
            <div class="ql-editor textarea" role="textbox" aria-label="Enter a prompt for Gemini" contenteditable="true"></div>
          </rich-textarea>
          <button aria-label="Send message"></button>
        </div>
      `;

      const composer = document.querySelector<HTMLElement>('.ql-editor');
      composer?.addEventListener('paste', () => {
        window.setTimeout(() => {
          document.querySelector('.text-input-field')?.insertAdjacentHTML('afterbegin', `
            <uploader-file-preview class="file-preview-chip">
              <div class="file-preview-container" aria-describedby="tooltip-file-1">
                <gem-attachment class="gem-attachment gds-label-l gem-attachment-tile">
                  <span class="gem-attachment-text">潜规则-中国古代官民互动</span>
                </gem-attachment>
              </div>
            </uploader-file-preview>
          `);
          document.body.insertAdjacentHTML(
            'beforeend',
            '<div id="tooltip-file-1" role="tooltip">潜规则-中国古代官民互动.md</div>',
          );
        }, 35_000);
      });

      const delivery = geminiAdapter.composer?.setComposerPayload?.({
        text: 'hello',
        attachments: [
          {
            id: 'a1',
            name: '潜规则-中国古代官民互动.md',
            mime: 'text/markdown',
            size: 3,
          },
        ],
      });

      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(30_500);
      expect(composer?.textContent).not.toContain('hello');

      await vi.advanceTimersByTimeAsync(10_000);
      await delivery;

      expect(composer?.textContent).toContain('hello');
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails closed when Gemini reports upload failure before readiness', async () => {
    document.body.innerHTML = `
      <div class="text-input-field">
        <rich-textarea>
          <div class="ql-editor textarea" role="textbox" aria-label="Enter a prompt for Gemini" contenteditable="true"></div>
        </rich-textarea>
        <button aria-label="Send message" disabled></button>
      </div>
    `;

    const composer = document.querySelector<HTMLElement>('.ql-editor');
    composer?.addEventListener('paste', () => {
      document.querySelector('.text-input-field')?.insertAdjacentHTML('afterbegin', `
        <uploader-file-preview class="file-preview-chip">
          <gem-attachment class="gem-attachment gds-label-l gem-attachment-tile">
            <span class="gem-attachment-text">notes.md</span>
          </gem-attachment>
        </uploader-file-preview>
      `);
      document.body.insertAdjacentHTML('beforeend', '<div class="mat-mdc-snack-bar-container">Failed to upload notes.md</div>');
    });

    await expect(geminiAdapter.composer?.setComposerPayload?.({
      text: 'hello',
      attachments: [
        {
          id: 'a1',
          name: 'notes.md',
          mime: 'text/markdown',
          size: 3,
        },
      ],
    })).rejects.toThrow('upload failed');
    expect(composer?.textContent).not.toContain('hello');
  });

  it('attaches Gemini readiness diagnostics when upload wait times out', async () => {
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout'],
    });
    try {
      document.body.innerHTML = `
        <div class="text-input-field">
          <rich-textarea>
            <div class="ql-editor textarea" role="textbox" aria-label="Enter a prompt for Gemini" contenteditable="true"></div>
          </rich-textarea>
          <button aria-label="Send message" disabled></button>
        </div>
      `;

      const composer = document.querySelector<HTMLElement>('.ql-editor');
      const delivery = geminiAdapter.composer?.setComposerPayload?.({
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
      const rejection = Promise.resolve(delivery).then(
        () => null,
        (error: Error & { askEmDiagnostic?: string }) => error,
      );

      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(60_500);

      await expect(rejection).resolves.toMatchObject({
        message: 'upload failed',
        askEmDiagnostic: expect.stringContaining('gemini attachment ready timeout'),
      });
      await expect(rejection).resolves.toMatchObject({
        askEmDiagnostic: expect.stringContaining('sendReady=false'),
      });
      expect(composer?.textContent).not.toContain('hello');
    } finally {
      vi.useRealTimers();
    }
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

  it('counts multiple Gemini file tiles inside one uploader preview wrapper', async () => {
    document.body.innerHTML = `
      <div class="text-input-field with-file-preview">
        <uploader-file-preview class="file-preview-strip">
          <gem-attachment class="gem-attachment gds-label-l gem-attachment-tile">
            <span class="gem-attachment-text">deck.pdf</span>
          </gem-attachment>
          <gem-attachment class="gem-attachment gds-label-l gem-attachment-tile">
            <span class="gem-attachment-text">notes.pdf</span>
          </gem-attachment>
        </uploader-file-preview>
        <div class="ql-editor textarea" role="textbox" aria-label="Enter a prompt for Gemini" contenteditable="true"></div>
        <button aria-label="Send message"></button>
      </div>
    `;

    await expect(Promise.resolve(geminiAdapter.composer?.getComposerAttachmentPresence?.([
      {
        id: 'a1',
        name: 'deck.pdf',
        mime: 'application/pdf',
        size: 3,
      },
      {
        id: 'a2',
        name: 'notes.pdf',
        mime: 'application/pdf',
        size: 4,
      },
    ]))).resolves.toEqual({
      count: 2,
      keys: ['deck.pdf', 'notes.pdf'],
    });
  });

  it('reports Gemini video attachment presence from media preview tooltip text', async () => {
    document.body.innerHTML = `
      <div class="text-input-field with-file-preview">
        <div class="attachment-preview-wrapper">
          <uploader-file-preview class="file-preview-chip">
            <div class="file-preview-container" aria-describedby="tooltip-file-1">
              <gem-media-attachment class="gem-attachment gds-label-l clickable gem-attachment-tile">
                <span class="gem-attachment-content">0:32</span>
              </gem-media-attachment>
            </div>
          </uploader-file-preview>
        </div>
        <div class="ql-editor textarea" role="textbox" aria-label="Enter a prompt for Gemini" contenteditable="true"></div>
        <button aria-label="Send message"></button>
      </div>
      <div class="cdk-describedby-message-container" style="visibility: hidden;">
        <div id="tooltip-file-1" role="tooltip">test.mp4</div>
      </div>
    `;

    await expect(Promise.resolve(geminiAdapter.composer?.getComposerAttachmentPresence?.([
      {
        id: 'a1',
        name: 'test.mp4',
        mime: 'video/mp4',
        size: 4_059_345,
      },
    ]))).resolves.toEqual({
      count: 1,
      keys: ['test.mp4'],
    });
  });

  it('matches long Gemini filenames from aria-describedby tooltip text when the visible tile is truncated', async () => {
    document.body.innerHTML = `
      <div class="text-input-field with-file-preview">
        <uploader-file-preview class="file-preview-chip">
          <div class="file-preview-container" aria-describedby="tooltip-file-1">
            <gem-attachment class="gem-attachment gds-label-l gem-attachment-tile">
              <span class="gem-attachment-text">20180301-中...码解除_PT0BYq</span>
            </gem-attachment>
          </div>
        </uploader-file-preview>
        <uploader-file-preview class="file-preview-chip">
          <div class="file-preview-container" aria-describedby="tooltip-file-2">
            <gem-attachment class="gem-attachment gds-label-l gem-attachment-tile">
              <span class="gem-attachment-text">The_Murders</span>
            </gem-attachment>
          </div>
        </uploader-file-preview>
        <div class="ql-editor textarea" role="textbox" aria-label="Enter a prompt for Gemini" contenteditable="true"></div>
        <button aria-label="Send message"></button>
      </div>
      <div class="cdk-describedby-message-container" style="visibility: hidden;">
        <div id="tooltip-file-1" role="tooltip">20180301-中邮证券-白马被抛弃？_密码解除_PT0BYq.pdf</div>
        <div id="tooltip-file-2" role="tooltip">The_Murders.pdf</div>
      </div>
    `;

    await expect(Promise.resolve(geminiAdapter.composer?.getComposerAttachmentPresence?.([
      {
        id: 'a1',
        name: '20180301-中邮证券-白马被抛弃？_密码解除_PT0BYq.pdf',
        mime: 'application/pdf',
        size: 3,
      },
      {
        id: 'a2',
        name: 'The_Murders.pdf',
        mime: 'application/pdf',
        size: 4,
      },
    ]))).resolves.toEqual({
      count: 2,
      keys: [
        '20180301-中邮证券-白马被抛弃？_密码解除_PT0BYq.pdf',
        'The_Murders.pdf',
      ],
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

  it('clicks the localized Gemini send button without clicking the disabled host', async () => {
    document.body.innerHTML = `
      <div class="text-input-field">
        <rich-textarea>
          <div class="ql-editor textarea new-input-ui" role="textbox" aria-label="为 Gemini 输入提示" contenteditable="true">hello</div>
        </rich-textarea>
        <gem-icon-button class="send-button submit has-input" aria-disabled="false">
          <button aria-label="发送"></button>
        </gem-icon-button>
      </div>
    `;
    const sendButton = document.querySelector<HTMLButtonElement>('button[aria-label="发送"]');
    let clickedSend = false;

    sendButton?.addEventListener('click', () => {
      clickedSend = true;
    });

    await geminiAdapter.composer?.submit({ timeoutMs: 250 });

    expect(clickedSend).toBe(true);
  });

  it('captures multiple Gemini transient upload files from one picker event before submit', () => {
    document.body.innerHTML = `
      <div class="text-input-field with-file-preview">
        <div class="attachment-preview-wrapper">
          <uploader-file-preview class="file-preview-chip">
            <gem-attachment class="gem-attachment gds-label-l gem-attachment-tile">
              <span class="gem-attachment-text">deck</span>
            </gem-attachment>
          </uploader-file-preview>
          <uploader-file-preview class="file-preview-chip">
            <gem-attachment class="gem-attachment gds-label-l gem-attachment-tile">
              <span class="gem-attachment-text">notes</span>
            </gem-attachment>
          </uploader-file-preview>
        </div>
        <div class="ql-editor textarea" role="textbox" aria-label="Enter a prompt for Gemini" contenteditable="true">hello</div>
        <button aria-label="Send message"></button>
      </div>
    `;

    const deck = new File(['abc'], 'deck.pdf', { type: 'application/pdf' });
    const notes = new File(['def'], 'notes.md', { type: 'text/markdown' });
    const onSubmit = vi.fn();
    const unsubscribe = geminiAdapter.composer?.subscribeToUserSubmissions?.(onSubmit);
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          source: 'ask-em',
          type: 'ASK_EM_TRANSIENT_FILES',
          files: [deck, notes],
        },
      }),
    );
    document.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello',
      attachments: [
        expect.objectContaining({
          file: deck,
          name: 'deck.pdf',
          mime: 'application/pdf',
          source: 'transient-file-input',
        }),
        expect.objectContaining({
          file: notes,
          name: 'notes.md',
          mime: 'text/markdown',
          source: 'transient-file-input',
        }),
      ],
      attachmentResolution: expect.objectContaining({
        capturedCount: 2,
        currentCount: 2,
        submittedCount: 2,
      }),
    }));
    unsubscribe?.();
  });

  it('captures multiple Gemini transient upload files from incremental picker events before submit', () => {
    document.body.innerHTML = `
      <div class="text-input-field with-file-preview">
        <div class="attachment-preview-wrapper">
          <uploader-file-preview class="file-preview-chip">
            <gem-attachment class="gem-attachment gds-label-l gem-attachment-tile">
              <span class="gem-attachment-text">first</span>
            </gem-attachment>
          </uploader-file-preview>
          <uploader-file-preview class="file-preview-chip">
            <gem-attachment class="gem-attachment gds-label-l gem-attachment-tile">
              <span class="gem-attachment-text">second</span>
            </gem-attachment>
          </uploader-file-preview>
        </div>
        <div class="ql-editor textarea" role="textbox" aria-label="Enter a prompt for Gemini" contenteditable="true">hello</div>
        <button aria-label="Send message"></button>
      </div>
    `;

    const first = new File(['abc'], 'first.pdf', { type: 'application/pdf' });
    const second = new File(['def'], 'second.md', { type: 'text/markdown' });
    const onSubmit = vi.fn();
    const unsubscribe = geminiAdapter.composer?.subscribeToUserSubmissions?.(onSubmit);
    for (const file of [first, second]) {
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
    }
    document.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello',
      attachments: [
        expect.objectContaining({
          file: first,
          name: 'first.pdf',
          mime: 'application/pdf',
          source: 'transient-file-input',
        }),
        expect.objectContaining({
          file: second,
          name: 'second.md',
          mime: 'text/markdown',
          source: 'transient-file-input',
        }),
      ],
      attachmentResolution: expect.objectContaining({
        capturedCount: 2,
        currentCount: 2,
        submittedCount: 2,
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
