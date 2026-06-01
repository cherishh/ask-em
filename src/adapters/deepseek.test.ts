// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deepseekAdapter } from './deepseek';
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

function renderDeepseekComposer(extra = '') {
  document.body.innerHTML = `
    <div class="_77cefa5 _9996a53 focused _1d5e44c">
      ${extra}
      <div class="_020ab5b">
        <div class="_24fad49">
          <textarea placeholder="Message DeepSeek" rows="2"></textarea>
        </div>
        <div>
          <div class="ds-atom-button ds-toggle-button" role="button" aria-disabled="false">DeepThink</div>
          <div class="ds-atom-button ds-toggle-button" role="button" aria-disabled="false">Search</div>
          <div class="f02f0e25 ds-icon-button ds-icon-button--l ds-icon-button--sizing-container" role="button" aria-disabled="false"></div>
          <input id="upload-files" type="file" accept=".pdf,.html,.md,.txt,text/markdown,application/pdf" multiple style="display: none;" />
          <div id="send" class="_52c986b ds-icon-button ds-icon-button--l ds-icon-button--sizing-container" role="button" aria-disabled="false"></div>
        </div>
      </div>
    </div>
  `;
}

function renderLocalizedDeepseekComposer() {
  document.body.innerHTML = `
    <div class="_77cefa5 _9996a53 focused">
      <div class="_020ab5b">
        <div class="_24fad49">
          <textarea
            class="_27c9245 ds-scroll-area ds-scroll-area--show-on-focus-within ds-scroll-area--enabled d96f2d2a"
            placeholder="给 DeepSeek 发送消息 "
            rows="2"
            autocomplete="off"
            name="search"
          ></textarea>
        </div>
        <div class="ec4f5d61">
          <div class="ds-button ds-button--iconLabelPrimary ds-button--icon ds-button--capsule ds-button--s ds-button--icon-relative-m f02f0e25" role="button"></div>
          <div id="send" class="ds-button ds-button--primary ds-button--filled ds-button--circle ds-button--m ds-button--icon-relative-m _52c986b" role="button"></div>
        </div>
      </div>
    </div>
  `;
}

describe('DeepSeek attachment delivery adapter', () => {
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

  it('sets text and injects reconstructed files through the scoped DeepSeek file input', async () => {
    renderDeepseekComposer();

    await deepseekAdapter.composer?.setComposerPayload?.({
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
    expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('hello');
  });

  it('treats the localized DeepSeek composer as ready', () => {
    renderLocalizedDeepseekComposer();

    expect(deepseekAdapter.session.getStatus().pageState).toBe('ready');
  });

  it('fails fast when no scoped DeepSeek file input exists', async () => {
    document.body.innerHTML = `
      <div class="_77cefa5">
        <div class="_020ab5b">
          <div class="_24fad49"><textarea placeholder="Message DeepSeek"></textarea></div>
          <div class="_52c986b ds-icon-button" role="button" aria-disabled="false"></div>
        </div>
      </div>
    `;

    await expect(deepseekAdapter.composer?.setComposerPayload?.({
      text: 'hello',
      attachments: [
        {
          id: 'a1',
          name: 'sample.pdf',
          mime: 'application/pdf',
          size: 3,
        },
      ],
    })).rejects.toThrow('upload failed');
  });

  it('reports attachment presence from DeepSeek animated attachment items', async () => {
    renderDeepseekComposer(`
      <div class="b40079d7 _6f68655">
        <div class="ds-animated-size-item">
          <div class="_76cd190 _0004e59">
            <div class="_7e13492">test3.html</div>
            <div class="_5119742">HTML 6.89KB</div>
          </div>
        </div>
        <div class="ds-animated-size-item">
          <div class="_76cd190 _0004e59">
            <div class="_7e13492">The_Murders.pdf</div>
            <div class="_5119742">PDF 469.21KB</div>
          </div>
        </div>
      </div>
    `);

    await expect(Promise.resolve(deepseekAdapter.composer?.getComposerAttachmentPresence?.([
      {
        id: 'a1',
        name: 'test3.html',
        mime: 'text/html',
        size: 3,
      },
      {
        id: 'a2',
        name: 'The_Murders.pdf',
        mime: 'application/pdf',
        size: 4,
      },
    ]))).resolves.toMatchObject({
      count: 2,
      keys: expect.arrayContaining(['test3.html', 'The_Murders.pdf']),
    });
  });

  it('does not let an old DeepSeek draft attachment satisfy a new expected file', async () => {
    renderDeepseekComposer(`
      <div class="b40079d7 _6f68655">
        <div class="ds-animated-size-item">
          <div class="_76cd190 _0004e59">
            <div class="_7e13492">new-report-old.pdf</div>
            <div class="_5119742">PDF 12KB</div>
          </div>
        </div>
      </div>
    `);

    await expect(Promise.resolve(deepseekAdapter.composer?.getComposerAttachmentPresence?.([
      {
        id: 'a1',
        name: 'new-report.pdf',
        mime: 'application/pdf',
        size: 3,
      },
    ]))).resolves.toEqual({
      count: 0,
      keys: [],
    });
  });

  it('uses a scoped DeepSeek file input even when accept does not match', async () => {
    document.body.innerHTML = `
      <div class="_77cefa5">
        <div class="_020ab5b">
          <div class="_24fad49"><textarea placeholder="Message DeepSeek"></textarea></div>
          <input id="upload-files" type="file" accept=".png" multiple />
          <div class="_52c986b ds-icon-button" role="button" aria-disabled="false"></div>
        </div>
      </div>
    `;

    await deepseekAdapter.composer?.setComposerPayload?.({
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
    expect(input.files?.[0]?.name).toBe('sample.pdf');
  });

  it('matches duplicate DeepSeek preview cards as separate current attachments', () => {
    renderDeepseekComposer(`
      <div class="b40079d7 _6f68655">
        <div class="ds-animated-size-item"><div>report.pdf PDF 12KB</div></div>
        <div class="ds-animated-size-item"><div>report.pdf PDF 14KB</div></div>
      </div>
    `);

    expect(deepseekAdapter.composer?.getComposerAttachmentSnapshot?.([
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
      items: ['report.pdf', 'report.pdf'],
    });
  });

  it('detects DeepSeek upload failure messaging', async () => {
    renderDeepseekComposer();
    document.body.insertAdjacentHTML('beforeend', '<div role="alert">Failed to upload sample.pdf</div>');

    await expect(Promise.resolve(deepseekAdapter.composer?.detectAttachmentUploadError?.())).resolves.toBe('upload failed');
  });

  it('does not count DeepSeek failed attachment chips as delivered attachments', async () => {
    renderDeepseekComposer(`
      <div class="b40079d7 _6f68655">
        <div class="ds-animated-size-item">
          <div class="_76cd190 _0004e59">
            <div class="_7e13492">bf-0925.zip</div>
            <div class="_5119742">Unsupported file format</div>
          </div>
        </div>
      </div>
    `);
    const attachments = [
      {
        id: 'a1',
        name: 'bf-0925.zip',
        mime: 'application/zip',
        size: 750_943,
      },
    ];

    await expect(Promise.resolve(deepseekAdapter.composer?.getComposerAttachmentPresence?.(attachments))).resolves.toEqual({
      count: 0,
      keys: [],
    });
    await expect(Promise.resolve(deepseekAdapter.composer?.detectAttachmentUploadError?.())).resolves.toBe('upload failed');
  });

  it('does not count DeepSeek filename-only pending chips as delivered attachments', async () => {
    renderDeepseekComposer(`
      <div class="b40079d7 _6f68655">
        <div class="ds-animated-size-item">
          <div class="_76cd190 _0004e59">
            <div class="_7e13492">bf-0925.zip</div>
          </div>
        </div>
      </div>
    `);

    await expect(Promise.resolve(deepseekAdapter.composer?.getComposerAttachmentPresence?.([
      {
        id: 'a1',
        name: 'bf-0925.zip',
        mime: 'application/zip',
        size: 750_943,
      },
    ]))).resolves.toEqual({
      count: 0,
      keys: [],
    });
    await expect(Promise.resolve(deepseekAdapter.composer?.detectAttachmentUploadError?.())).resolves.toBeNull();
  });

  it('clicks the DeepSeek send icon without hitting DeepThink, Search, or upload', async () => {
    renderDeepseekComposer();
    const send = document.getElementById('send') as HTMLElement;
    let clickedSend = false;
    let clickedToggle = false;
    let clickedUpload = false;

    send.addEventListener('click', () => {
      clickedSend = true;
    });
    document.querySelector<HTMLElement>('.ds-atom-button')?.addEventListener('click', () => {
      clickedToggle = true;
    });
    document.querySelector<HTMLElement>('.f02f0e25')?.addEventListener('click', () => {
      clickedUpload = true;
    });

    await deepseekAdapter.composer?.submit({ timeoutMs: 250 });

    expect(clickedSend).toBe(true);
    expect(clickedToggle).toBe(false);
    expect(clickedUpload).toBe(false);
  });

  it('clicks the localized DeepSeek send button without hitting upload', async () => {
    renderLocalizedDeepseekComposer();
    const send = document.getElementById('send') as HTMLElement;
    const upload = document.querySelector<HTMLElement>('.f02f0e25');
    let clickedSend = false;
    let clickedUpload = false;

    send.addEventListener('click', () => {
      clickedSend = true;
    });
    upload?.addEventListener('click', () => {
      clickedUpload = true;
    });

    await deepseekAdapter.composer?.submit({ timeoutMs: 250 });

    expect(clickedSend).toBe(true);
    expect(clickedUpload).toBe(false);
  });
});
