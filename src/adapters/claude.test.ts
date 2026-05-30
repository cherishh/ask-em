// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claudeAdapter } from './claude';
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

describe('Claude attachment delivery adapter', () => {
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

  it('reports attachment presence from Claude file cards that show the expected filename', async () => {
    document.body.innerHTML = `
      <fieldset>
        <input data-testid="file-upload" aria-label="Upload files" type="file" />
        <div>
          <div data-testid="file-thumbnail">
            <button>
              <h3>潜规则-中国古代<br />官民互动.md</h3>
              <p>MD</p>
            </button>
          </div>
          <div>
            <div data-testid="chat-input" contenteditable="true"></div>
            <button type="button" aria-label="Send message"></button>
          </div>
        </div>
      </fieldset>
    `;

    await expect(Promise.resolve(claudeAdapter.composer?.getComposerAttachmentPresence?.([
      {
        id: 'a1',
        name: '潜规则-中国古代官民互动.md',
        mime: 'text/markdown',
        size: 3,
      },
    ]))).resolves.toMatchObject({
      count: 1,
    });
  });

  it('reads submit-time source attachment snapshots from Claude file cards', () => {
    document.body.innerHTML = `
      <fieldset>
        <input data-testid="file-upload" aria-label="Upload files" type="file" />
        <div data-testid="file-thumbnail">
          <button>
            <h3>潜规则-中国古代<br />官民互动.md</h3>
            <p>MD</p>
          </button>
        </div>
        <div data-testid="chat-input" contenteditable="true"></div>
      </fieldset>
    `;

    expect(claudeAdapter.composer?.getComposerAttachmentSnapshot?.([
      {
        id: 'a1',
        name: '潜规则-中国古代官民互动.md',
        mime: 'text/markdown',
        size: 3,
        source: 'file-input',
        file: new File(['abc'], '潜规则-中国古代官民互动.md', { type: 'text/markdown' }),
      },
    ])).toMatchObject({
      count: 1,
      items: [expect.stringContaining('潜规则-中国古代')],
    });
  });

  it('reads submit-time source attachment snapshots from current Claude PDF preview controls', () => {
    document.body.innerHTML = `
      <fieldset>
        <input data-testid="file-upload" aria-label="Upload files" type="file" />
        <div>
          <img alt="1780068008519_The_Murders_near_Mapleton_An_Anthony_Bathurst_Mystery_-_Flynn__Brian_4__1__LMH7ch.pdf" />
          <button
            type="button"
            aria-label="Remove 1780068008519_The_Murders_near_Mapleton_An_Anthony_Bathurst_Mystery_-_Flynn__Brian_4__1__LMH7ch.pdf"
          ></button>
        </div>
        <div data-testid="chat-input" contenteditable="true"></div>
      </fieldset>
    `;

    expect(claudeAdapter.composer?.getComposerAttachmentSnapshot?.([
      {
        id: 'a1',
        name: 'The_Murders_near_Mapleton_An_Anthony_Bathurst_Mystery_-_Flynn__Brian_4__1__LMH7ch.pdf',
        mime: 'application/pdf',
        size: 3,
        source: 'paste',
        file: new File(['abc'], 'The_Murders_near_Mapleton_An_Anthony_Bathurst_Mystery_-_Flynn__Brian_4__1__LMH7ch.pdf', {
          type: 'application/pdf',
        }),
      },
    ])).toMatchObject({
      count: 1,
      items: [expect.stringContaining('The_Murders_near_Mapleton')],
    });
  });

  it('does not reuse one Claude preview for duplicate captured filenames', () => {
    document.body.innerHTML = `
      <fieldset>
        <input data-testid="file-upload" aria-label="Upload files" type="file" />
        <div>
          <img alt="report.pdf" />
          <button type="button" aria-label="Remove report.pdf"></button>
        </div>
        <div data-testid="chat-input" contenteditable="true"></div>
      </fieldset>
    `;

    expect(claudeAdapter.composer?.getComposerAttachmentSnapshot?.([
      {
        id: 'a1',
        name: 'report.pdf',
        mime: 'application/pdf',
        size: 3,
        source: 'paste',
        file: new File(['abc'], 'report.pdf', { type: 'application/pdf' }),
      },
      {
        id: 'a2',
        name: 'report.pdf',
        mime: 'application/pdf',
        size: 3,
        source: 'paste',
        file: new File(['def'], 'report.pdf', { type: 'application/pdf' }),
      },
    ])).toMatchObject({
      count: 1,
      items: [expect.stringContaining('report.pdf')],
    });
  });

  it('counts duplicate Claude preview controls as separate current attachments', () => {
    document.body.innerHTML = `
      <fieldset>
        <input data-testid="file-upload" aria-label="Upload files" type="file" />
        <div>
          <button type="button" aria-label="Remove report.pdf"></button>
          <button type="button" aria-label="Remove report.pdf"></button>
        </div>
        <div data-testid="chat-input" contenteditable="true"></div>
      </fieldset>
    `;

    expect(claudeAdapter.composer?.getComposerAttachmentSnapshot?.([
      {
        id: 'a1',
        name: 'report.pdf',
        mime: 'application/pdf',
        size: 3,
        source: 'file-input',
        file: new File(['abc'], 'report.pdf', { type: 'application/pdf' }),
      },
      {
        id: 'a2',
        name: 'report.pdf',
        mime: 'application/pdf',
        size: 3,
        source: 'file-input',
        file: new File(['def'], 'report.pdf', { type: 'application/pdf' }),
      },
    ])).toMatchObject({
      count: 2,
      items: ['Remove report.pdf', 'Remove report.pdf'],
    });
  });

  it('captures detached Claude upload input files and confirms duplicate previews at submit time', () => {
    document.body.innerHTML = `
      <input id="upload" data-testid="file-upload" aria-label="Upload files" type="file" multiple />
      <fieldset>
        <div>
          <button type="button" aria-label="Remove report.pdf"></button>
          <button type="button" aria-label="Remove report.pdf"></button>
        </div>
        <div data-testid="chat-input" contenteditable="true">summarize</div>
        <button type="button" aria-label="Send message"></button>
      </fieldset>
    `;

    const input = document.getElementById('upload') as HTMLInputElement;
    const files = [
      new File(['abc'], 'report.pdf', { type: 'application/pdf' }),
      new File(['def'], 'report.pdf', { type: 'application/pdf' }),
    ];
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: files,
    });

    const onSubmit = vi.fn();
    const unsubscribe = claudeAdapter.composer?.subscribeToUserSubmissions?.(onSubmit);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      text: 'summarize',
      attachments: [
        expect.objectContaining({
          file: files[0],
          name: 'report.pdf',
          source: 'file-input',
        }),
        expect.objectContaining({
          file: files[1],
          name: 'report.pdf',
          source: 'file-input',
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

  it('returns an empty source snapshot after Claude file cards are removed', () => {
    document.body.innerHTML = `
      <fieldset>
        <input data-testid="file-upload" aria-label="Upload files" type="file" />
        <div data-testid="chat-input" contenteditable="true"></div>
      </fieldset>
    `;

    expect(claudeAdapter.composer?.getComposerAttachmentSnapshot?.([
      {
        id: 'a1',
        name: 'removed.md',
        mime: 'text/markdown',
        size: 3,
        source: 'file-input',
        file: new File(['abc'], 'removed.md', { type: 'text/markdown' }),
      },
    ])).toEqual({
      count: 0,
      items: [],
    });
  });

  it('clicks Claude send buttons with current aria labels', async () => {
    document.body.innerHTML = `
      <form>
        <div data-testid="chat-input" contenteditable="true"></div>
        <button type="button" aria-label="Send"></button>
      </form>
    `;
    const button = document.querySelector('button') as HTMLButtonElement;
    let clicked = false;
    button.addEventListener('click', () => {
      clicked = true;
    });

    await claudeAdapter.composer?.submit({ timeoutMs: 250 });

    expect(clicked).toBe(true);
  });
});
