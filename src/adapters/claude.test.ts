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

function rectFromAttribute(element: HTMLElement) {
  const value = element.getAttribute('data-rect');
  const [x, y, width, height] = value
    ? value.split(',').map((part) => Number(part.trim()))
    : [0, 0, 160, 36];

  return {
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    x,
    y,
    toJSON() {
      return {};
    },
  };
}

function mockClaudeComposerLayout(rectSpy: ReturnType<typeof vi.spyOn>) {
  rectSpy.mockImplementation(function (this: HTMLElement) {
    return rectFromAttribute(this);
  });
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

  it('counts mixed Claude document and PDF preview card shapes together', async () => {
    document.body.innerHTML = `
      <fieldset>
        <input data-testid="file-upload" aria-label="Upload files" type="file" />
        <div>
          <div data-testid="file-thumbnail">
            <button aria-label="test3.html, html, 146 lines">
              <div>test3.html</div>
              <div>146 lines</div>
              <div>HTML</div>
            </button>
          </div>
          <div>
            <img alt="The_Murders.pdf" />
            <button type="button" aria-label="Remove The_Murders.pdf"></button>
          </div>
          <div data-testid="chat-input" contenteditable="true"></div>
          <button type="button" aria-label="Send message"></button>
        </div>
      </fieldset>
    `;

    await expect(Promise.resolve(claudeAdapter.composer?.getComposerAttachmentPresence?.([
      {
        id: 'a1',
        name: 'The_Murders.pdf',
        mime: 'application/pdf',
        size: 3,
      },
      {
        id: 'a2',
        name: 'test3.html',
        mime: 'text/html',
        size: 3,
      },
    ]))).resolves.toMatchObject({
      count: 2,
      keys: expect.arrayContaining([
        expect.stringContaining('The_Murders.pdf'),
        expect.stringContaining('test3.html'),
      ]),
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

  it('counts Claude provider-generated pasted text as one source attachment', () => {
    document.body.innerHTML = `
      <fieldset>
        <input data-testid="file-upload" aria-label="Upload files" type="file" />
        <div data-testid="file-thumbnail">
          <button>
            <h3>Pasted Text</h3>
            <p>PASTED</p>
          </button>
        </div>
        <button type="button" aria-label="Remove Pasted Text, pasted, 483 lines"></button>
        <div data-testid="chat-input" contenteditable="true"></div>
      </fieldset>
    `;

    expect(claudeAdapter.composer?.getComposerAttachmentSnapshot?.([
      {
        id: 'a1',
        name: 'pasted-text-1.txt',
        mime: 'text/plain',
        size: 15_000,
        source: 'pasted-text',
        file: new File(['abc'], 'pasted-text-1.txt', { type: 'text/plain' }),
      },
    ])).toMatchObject({
      count: 1,
      items: [expect.stringContaining('Pasted Text')],
    });
  });

  it('combines Claude pasted text and named files in source snapshots', () => {
    document.body.innerHTML = `
      <fieldset>
        <input data-testid="file-upload" aria-label="Upload files" type="file" />
        <div data-testid="file-thumbnail">
          <button>
            <h3>Pasted Text</h3>
            <p>PASTED</p>
          </button>
        </div>
        <button type="button" aria-label="Remove Pasted Text, pasted, 483 lines"></button>
        <button type="button" aria-label="Remove report.pdf"></button>
        <div data-testid="chat-input" contenteditable="true"></div>
      </fieldset>
    `;

    expect(claudeAdapter.composer?.getComposerAttachmentSnapshot?.([
      {
        id: 'a1',
        name: 'pasted-text-1.txt',
        mime: 'text/plain',
        size: 15_000,
        source: 'pasted-text',
        file: new File(['abc'], 'pasted-text-1.txt', { type: 'text/plain' }),
      },
      {
        id: 'a2',
        name: 'report.pdf',
        mime: 'application/pdf',
        size: 3,
        source: 'file-input',
        file: new File(['abc'], 'report.pdf', { type: 'application/pdf' }),
      },
    ])).toMatchObject({
      count: 2,
      items: [
        expect.stringContaining('report.pdf'),
        expect.stringContaining('Pasted Text'),
      ],
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

  it('detects upload errors only inside alert/toast surfaces, not the prompt or transcript', async () => {
    document.body.innerHTML = `
      <div data-testid="chat-input" contenteditable="true">My essay on why every upload failed in 1998.</div>
      <div class="message">Earlier message: the build failed to upload to S3.</div>
    `;
    // The injected prompt and transcript mention the trigger phrases but must NOT
    // be treated as an upload error.
    expect(await claudeAdapter.composer?.detectAttachmentUploadError?.()).toBeNull();

    document.body.innerHTML += `<div role="alert">Upload failed</div>`;
    expect(await claudeAdapter.composer?.detectAttachmentUploadError?.()).toBe('upload failed');
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

  it('clicks localized Claude send buttons from the composer control row', async () => {
    mockClaudeComposerLayout(rectSpy);
    document.body.innerHTML = `
      <fieldset data-rect="648,335,672,122">
        <input data-testid="file-upload" aria-label="Subir archivos" type="file" />
        <div data-testid="chat-input" contenteditable="true" data-rect="669,356,638,22">hola</div>
        <button type="button" aria-label="Agregar archivos" data-rect="665,410,32,32"></button>
        <button type="button" data-testid="model-selector-dropdown" data-rect="1057,410,170,32"></button>
        <button type="button" aria-label="Configuracion" data-rect="1235,410,32,32"></button>
        <button type="button" aria-label="Mantener para grabar" data-rect="1235,410,32,32"></button>
        <button type="button" aria-label="Enviar mensaje" data-rect="1286,421,10,10"></button>
      </fieldset>
    `;
    const button = document.querySelector<HTMLButtonElement>('button[aria-label="Enviar mensaje"]');
    let clicked = false;
    button?.addEventListener('click', () => {
      clicked = true;
    });

    await claudeAdapter.composer?.submit({ timeoutMs: 250 });

    expect(clicked).toBe(true);
  });

  it('captures localized Claude send button clicks from the composer control row', () => {
    mockClaudeComposerLayout(rectSpy);
    document.body.innerHTML = `
      <fieldset data-rect="648,335,672,122">
        <input data-testid="file-upload" aria-label="Subir archivos" type="file" />
        <div data-testid="chat-input" contenteditable="true" data-rect="669,356,638,22">hola</div>
        <button type="button" aria-label="Agregar archivos" data-rect="665,410,32,32"></button>
        <button type="button" data-testid="model-selector-dropdown" data-rect="1057,410,170,32"></button>
        <button type="button" aria-label="Configuracion" data-rect="1235,410,32,32"></button>
        <button type="button" aria-label="Mantener para grabar" data-rect="1235,410,32,32"></button>
        <button type="button" aria-label="Enviar mensaje" data-rect="1286,421,10,10"></button>
      </fieldset>
    `;
    const onSubmit = vi.fn();
    const unsubscribe = claudeAdapter.composer?.subscribeToUserSubmissions?.(onSubmit);

    document.querySelector<HTMLButtonElement>('button[aria-label="Enviar mensaje"]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hola',
    }));
    unsubscribe?.();
  });
});
