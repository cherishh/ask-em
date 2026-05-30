// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { manusAdapter } from './manus';
import { installTransientFileInputHook } from '../content/transient-file-input-main';

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

function renderManusComposer() {
  document.body.innerHTML = `
    <div class="flex flex-col gap-3 rounded-[22px] relative bg-[var(--background-menu-white)]">
      <div id="attachments"></div>
      <div>
        <div class="tiptap ProseMirror" contenteditable="true"></div>
      </div>
      <div>
        <button id="tools" type="button" class="rounded-full">
          <svg class="lucide lucide-plus"></svg>
        </button>
        <button id="send" type="button" class="bg-[var(--Button-black)]"></button>
      </div>
    </div>
  `;

  document.getElementById('tools')?.addEventListener('click', () => {
    if (document.getElementById('manus-menu')) {
      return;
    }

    const menu = document.createElement('div');
    menu.id = 'manus-menu';
    menu.setAttribute('role', 'dialog');
    const addLocalFiles = document.createElement('div');
    addLocalFiles.className = 'cursor-pointer';
    addLocalFiles.textContent = 'Add from local files';
    addLocalFiles.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.addEventListener('change', () => {
        const attachments = document.getElementById('attachments');
        if (!attachments) {
          return;
        }

        for (const file of Array.from(input.files ?? [])) {
          const card = document.createElement('div');
          card.className = 'group/attach';
          card.textContent = `${file.name} PDF · 3 B`;
          attachments.appendChild(card);
        }
      });
      input.click();
      menu.remove();
    });
    menu.appendChild(addLocalFiles);
    document.body.appendChild(menu);
  });
}

describe('Manus attachment delivery adapter', () => {
  let rectSpy: ReturnType<typeof vi.spyOn>;
  let uninstallTransientHook: () => void;

  beforeEach(() => {
    document.body.innerHTML = '';
    rectSpy = mockVisibleLayout();
    uninstallTransientHook = installTransientFileInputHook();
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
    uninstallTransientHook();
    rectSpy.mockRestore();
    vi.unstubAllGlobals();
    delete window.__ASK_EM_TRANSIENT_FILE_INPUT_HOOK__;
  });

  it('sets text and injects files through the Manus local-files transient input flow', async () => {
    renderManusComposer();

    await manusAdapter.composer?.setComposerPayload?.({
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

    expect(document.querySelector('.tiptap')?.textContent).toBe('hello');
    expect(document.getElementById('attachments')?.textContent).toContain('sample.pdf');
    expect(document.getElementById('manus-menu')).toBeNull();
  });

  it('reports Manus attachment presence from visible cards and aggregate counts', async () => {
    renderManusComposer();
    const attachments = document.getElementById('attachments');
    attachments?.insertAdjacentHTML('beforeend', `
      <div class="group/attach">The_Murders.pdf PDF · 469.21 KB</div>
      <button type="button">+2</button>
    `);

    await expect(Promise.resolve(manusAdapter.composer?.getComposerAttachmentPresence?.([
      {
        id: 'a1',
        name: 'The_Murders.pdf',
        mime: 'application/pdf',
        size: 3,
      },
      {
        id: 'a2',
        name: 'hidden-1.pdf',
        mime: 'application/pdf',
        size: 3,
      },
      {
        id: 'a3',
        name: 'hidden-2.pdf',
        mime: 'application/pdf',
        size: 3,
      },
    ]))).resolves.toEqual({
      count: 3,
      keys: undefined,
    });
  });

  it('does not count Manus integration +N controls as attachment aggregates', async () => {
    renderManusComposer();
    document.getElementById('attachments')?.insertAdjacentHTML('beforeend', `
      <div class="group/attach">source.pdf PDF · 3 B</div>
    `);
    document.querySelector('.rounded-\\[22px\\]')?.insertAdjacentHTML('beforeend', `
      <div aria-haspopup="dialog" class="cursor-pointer">
        <img alt="GitHub">
        <img alt="Google Drive">
        <span>+2</span>
      </div>
    `);

    await expect(Promise.resolve(manusAdapter.composer?.getComposerAttachmentPresence?.([
      {
        id: 'a1',
        name: 'source.pdf',
        mime: 'application/pdf',
        size: 3,
      },
    ]))).resolves.toEqual({
      count: 1,
      keys: [expect.stringContaining('source.pdf')],
    });
  });

  it('keeps visible Manus attachment keys when all cards are visible', () => {
    renderManusComposer();
    document.getElementById('attachments')?.insertAdjacentHTML('beforeend', `
      <div class="group/attach">a.pdf PDF · 3 B</div>
      <div class="group/attach">b.pdf PDF · 3 B</div>
    `);

    expect(manusAdapter.composer?.getComposerAttachmentSnapshot?.([
      {
        id: 'a1',
        name: 'a.pdf',
        mime: 'application/pdf',
        size: 3,
        source: 'file-input',
        file: new File(['abc'], 'a.pdf', { type: 'application/pdf' }),
      },
      {
        id: 'a2',
        name: 'b.pdf',
        mime: 'application/pdf',
        size: 3,
        source: 'file-input',
        file: new File(['def'], 'b.pdf', { type: 'application/pdf' }),
      },
    ])).toMatchObject({
      count: 2,
      items: [
        expect.stringContaining('a.pdf'),
        expect.stringContaining('b.pdf'),
      ],
    });
  });

  it('detects Manus upload failure messaging', async () => {
    renderManusComposer();
    document.body.insertAdjacentHTML('beforeend', '<div role="alert">Failed to upload sample.pdf</div>');

    await expect(Promise.resolve(manusAdapter.composer?.detectAttachmentUploadError?.())).resolves.toBe('upload failed');
  });

  it('detects the Manus free-plan multi-file upload modal', async () => {
    renderManusComposer();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div role="dialog">You can upload up to 1 file at once Upgrade to Pro for unlimited uploads.</div>',
    );

    await expect(Promise.resolve(manusAdapter.composer?.detectAttachmentUploadError?.())).resolves.toBe('upload failed');
  });

  it('clicks the current Manus send button style', async () => {
    renderManusComposer();
    const send = document.getElementById('send') as HTMLButtonElement;
    let clicked = false;
    send.addEventListener('click', () => {
      clicked = true;
    });

    await manusAdapter.composer?.submit({ timeoutMs: 250 });

    expect(clicked).toBe(true);
  });
});
