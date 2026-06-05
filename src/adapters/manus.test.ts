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

function mockManusComposerLayout(rectSpy: ReturnType<typeof vi.spyOn>) {
  rectSpy.mockImplementation(function (this: HTMLElement) {
    return rectFromAttribute(this);
  });
}

function renderManusComposer(input?: { newTaskText?: string; localFilesText?: string }) {
  document.body.innerHTML = `
    <button id="new-task" type="button">
      <svg class="lucide lucide-square-pen"></svg>
      ${input?.newTaskText ?? 'New task'}
    </button>
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

  document.getElementById('new-task')?.addEventListener('click', () => {
    document.getElementById('attachments')?.replaceChildren();
    document.getElementById('manus-menu')?.remove();
    document.querySelector('[role="dialog"]')?.remove();
  });

  document.getElementById('tools')?.addEventListener('click', () => {
    if (document.getElementById('manus-menu')) {
      return;
    }

    const menu = document.createElement('div');
    menu.id = 'manus-menu';
    menu.setAttribute('role', 'dialog');
    const addLocalFiles = document.createElement('div');
    addLocalFiles.className = 'cursor-pointer';
    addLocalFiles.textContent = input?.localFilesText ?? 'Add from local files';
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

function renderManusComposerWithDelayedTools() {
  document.body.innerHTML = `
    <div class="flex flex-col gap-3 rounded-[22px] relative bg-[var(--background-menu-white)]">
      <div id="attachments"></div>
      <div>
        <div class="tiptap ProseMirror" contenteditable="true"></div>
      </div>
      <div id="toolbar"></div>
    </div>
  `;

  window.setTimeout(() => {
    document.getElementById('toolbar')?.insertAdjacentHTML('beforeend', `
      <button id="tools" type="button" class="rounded-full">
        <svg class="lucide lucide-plus"></svg>
      </button>
      <button id="send" type="button" class="bg-[var(--Button-black)]"></button>
    `);

    document.getElementById('tools')?.addEventListener('click', () => {
      const menu = document.createElement('div');
      menu.id = 'manus-menu';
      menu.setAttribute('role', 'dialog');
      const addLocalFiles = document.createElement('div');
      addLocalFiles.className = 'cursor-pointer';
      addLocalFiles.textContent = 'Add from local files';
      addLocalFiles.addEventListener('click', () => {
        const card = document.createElement('div');
        card.className = 'group/attach';
        card.textContent = 'sample.pdf PDF · 3 B';
        document.getElementById('attachments')?.appendChild(card);
        menu.remove();
      });
      menu.appendChild(addLocalFiles);
      document.body.appendChild(menu);
    });
  }, 250);
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

  it.each([
    '从本地文件添加',
    'Aus lokalen Dateien hinzufügen',
    'Agregar desde archivos locales',
    'Ajouter depuis les fichiers locaux',
    'Aggiungi da file locali',
    'Adicionar de arquivos locais',
    'Adicionar a partir de ficheiros locais',
    'Thêm từ tệp cục bộ',
    '从本机档案新增',
    'ローカルファイルから追加',
    '로컬 파일에서 추가',
    'أضف من الملفات المحلية',
  ])('sets text and injects files through the localized Manus local-files flow: %s', async (localFilesText) => {
    renderManusComposer({ localFilesText });

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

  it('does not block on a missing transient delivery ack after Manus renders the attachment card', async () => {
    uninstallTransientHook();
    uninstallTransientHook = () => undefined;
    renderManusComposerWithDelayedTools();

    const delivery = manusAdapter.composer?.setComposerPayload?.({
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

    await new Promise((resolve) => window.setTimeout(resolve, 300));
    await delivery;

    expect(document.querySelector('.tiptap')?.textContent).toBe('hello');
    expect(document.getElementById('attachments')?.textContent).toContain('sample.pdf');
    expect(document.getElementById('manus-menu')).toBeNull();
  });

  it('prepares a clean new-chat delivery surface when Manus restores draft attachments', async () => {
    renderManusComposer();
    document.querySelector('.tiptap')!.textContent = 'restored draft';
    document.getElementById('attachments')?.insertAdjacentHTML('beforeend', `
      <div class="group/attach">
        <img alt="persisted.png" src="blob:https://manus.im/persisted">
      </div>
    `);

    await manusAdapter.composer?.prepareForDelivery?.({
      text: 'hello',
      attachments: [
        {
          id: 'a1',
          name: 'sample.pdf',
          mime: 'application/pdf',
          size: 3,
        },
      ],
      expectedSessionId: null,
      expectedUrl: null,
    });

    expect(document.querySelector('.tiptap')?.textContent).toBe('restored draft');
    expect(document.querySelectorAll('[class*="group/attach"]')).toHaveLength(0);
  });

  it('prepares a clean new-chat delivery surface from the localized Manus new-task button', async () => {
    renderManusComposer({ newTaskText: 'Nueva tarea' });
    document.querySelector('.tiptap')!.textContent = 'restored draft';
    document.getElementById('attachments')?.insertAdjacentHTML('beforeend', `
      <div class="group/attach">persisted.pdf PDF · 3 B</div>
    `);

    await manusAdapter.composer?.prepareForDelivery?.({
      text: 'hello',
      attachments: [
        {
          id: 'a1',
          name: 'sample.pdf',
          mime: 'application/pdf',
          size: 3,
        },
      ],
      expectedSessionId: null,
      expectedUrl: null,
    });

    expect(document.querySelector('.tiptap')?.textContent).toBe('restored draft');
    expect(document.querySelectorAll('[class*="group/attach"]')).toHaveLength(0);
  });

  it('does not leave an existing Manus session when the delivery surface is dirty', async () => {
    renderManusComposer();
    document.getElementById('attachments')?.insertAdjacentHTML('beforeend', `
      <div class="group/attach">persisted.pdf PDF · 3 B</div>
    `);

    await expect(manusAdapter.composer?.prepareForDelivery?.({
      text: 'hello',
      attachments: [
        {
          id: 'a1',
          name: 'sample.pdf',
          mime: 'application/pdf',
          size: 3,
        },
      ],
      expectedSessionId: 'existing-session',
      expectedUrl: 'https://manus.im/app/existing-session',
    })).rejects.toThrow('delivery surface not clean');

    expect(document.getElementById('attachments')?.textContent).toContain('persisted.pdf');
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

  it('counts Manus image attachment cards that only expose filenames through image alt text', async () => {
    renderManusComposer();
    document.getElementById('attachments')?.insertAdjacentHTML('beforeend', `
      <div class="group/attach">
        <img alt="text image for ds.png" src="blob:https://manus.im/image">
        <button type="button"><svg class="lucide lucide-x"></svg></button>
      </div>
    `);

    await expect(Promise.resolve(manusAdapter.composer?.getComposerAttachmentPresence?.([
      {
        id: 'a1',
        name: 'text image for ds.png',
        mime: 'image/png',
        size: 3,
      },
    ]))).resolves.toEqual({
      count: 1,
      keys: [expect.stringContaining('text image for ds.png')],
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

  it('clicks the rightmost Manus composer control when send styling is not present', async () => {
    mockManusComposerLayout(rectSpy);
    document.body.innerHTML = `
      <div class="flex flex-col gap-3 rounded-[22px]" data-rect="606,327,768,128">
        <div class="tiptap ProseMirror" contenteditable="true" data-rect="623,341,742,24">hola</div>
        <button type="button" data-rect="619,410,32,32">
          <svg class="lucide lucide-plus"></svg>
        </button>
        <button type="button" data-rect="659,410,91,32">+2</button>
        <button type="button" data-rect="758,410,237,32">Computadoras en la nube</button>
        <div data-rect="1289,410,32,32">
          <svg class="lucide lucide-mic"></svg>
        </div>
        <button id="localized-send" type="button" class="inline-flex rounded-full" data-rect="1329,410,32,32"></button>
      </div>
    `;
    const send = document.getElementById('localized-send') as HTMLButtonElement;
    let clicked = false;
    send.addEventListener('click', () => {
      clicked = true;
    });

    await manusAdapter.composer?.submit({ timeoutMs: 250 });

    expect(clicked).toBe(true);
  });
});
