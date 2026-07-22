// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFileInputDeliveryBridge } from '../content/file-input-delivery-main';
import { KIMI_ATTACHMENT_FANOUT_ENABLED } from '../runtime/protocol';
import { isKimiChatRoute, kimiAdapter } from './kimi';

const describeKimiAttachmentDelivery = KIMI_ATTACHMENT_FANOUT_ENABLED
  ? describe
  : describe.skip;
const itKimiPromptOnly = KIMI_ATTACHMENT_FANOUT_ENABLED ? it.skip : it;

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

function renderKimiComposer() {
  document.body.innerHTML = `
    <div id="chat-box">
      <div class="chat-input-editor" contenteditable="true" role="textbox"><p><br></p></div>
      <div class="send-button-container disabled"><svg name="Send"></svg></div>
    </div>
  `;
}

function renderKimiComposerWithToolkit() {
  document.body.innerHTML = `
    <div id="chat-box">
      <div class="chat-input-editor" contenteditable="true" role="textbox"><p><br></p></div>
      <div class="send-button-container disabled"><svg name="Send"></svg></div>
      <div class="icon-button toolkit-trigger-btn"></div>
    </div>
  `;
  document
    .querySelector('.toolkit-trigger-btn')
    ?.addEventListener('click', () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `
      <div class="n-popover">
        <div class="n-popover__content toolkit-popover">
          <label class="toolkit-item">
            <span>Add files &amp; photos</span>
            <input class="hidden-input" type="file" multiple accept="text/*,.pdf,.md" />
          </label>
        </div>
      </div>
    `,
      );
    });
}

function insertKimiFileCard(state: string, nameStem: string, ext: string) {
  document.getElementById('chat-box')?.insertAdjacentHTML(
    'beforeend',
    `
    <div class="file-card-container normal ${state}">
      <p class="file-card-info-name">${nameStem}</p>
      <span class="file-ext">${ext}</span>
      <span class="file-size">24 Bytes</span>
    </div>
  `,
  );
}

function insertKimiImageThumbnail(state: string) {
  document.getElementById('chat-box')?.insertAdjacentHTML(
    'beforeend',
    `
    <div class="image-thumbnail middle${state ? ` ${state}` : ''}">
      <span class="image-wrapper image-detail"><img class="image-main is-cover" /></span>
    </div>
  `,
  );
}

describe('Kimi adapter', () => {
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/');
    rectSpy = mockVisibleLayout();
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn((command: string, _showUi?: boolean, value?: string) => {
        if (command === 'selectAll') {
          return true;
        }
        const composer =
          document.querySelector<HTMLElement>('.chat-input-editor');
        if (command === 'insertText' && composer) {
          composer.textContent = value ?? '';
          return true;
        }
        if (command === 'delete' && composer) {
          composer.textContent = '';
          return true;
        }
        return false;
      }),
    });
  });

  afterEach(() => {
    rectSpy.mockRestore();
    Reflect.deleteProperty(document, 'execCommand');
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/');
  });

  it('recognizes Kimi chat routes but excludes chat history', () => {
    expect(isKimiChatRoute('https://www.kimi.com/')).toBe(true);
    expect(isKimiChatRoute('https://www.kimi.com/chat/conversation-id')).toBe(
      true,
    );
    expect(isKimiChatRoute('https://www.kimi.com/chat/history')).toBe(false);
    expect(isKimiChatRoute('https://www.kimi.com/chat/history/')).toBe(false);
    expect(isKimiChatRoute('https://www.kimi.com/agent-swarm')).toBe(false);
  });

  it('reports a normal new-chat composer as ready', () => {
    renderKimiComposer();

    expect(kimiAdapter.session.getStatus()).toMatchObject({
      provider: 'kimi',
      pageKind: 'new-chat',
      pageState: 'ready',
      sessionId: null,
    });
  });

  it('captures Kimi text submissions', () => {
    renderKimiComposer();
    const composer = document.querySelector<HTMLElement>('.chat-input-editor');
    const sendButton = document.querySelector<HTMLElement>(
      '.send-button-container',
    );
    if (composer) {
      composer.textContent = 'hello Kimi';
    }
    sendButton?.classList.remove('disabled');

    const onSubmit = vi.fn();
    const unsubscribe =
      kimiAdapter.composer?.subscribeToUserSubmissions?.(onSubmit);
    sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'hello Kimi',
        attachments: [],
      }),
    );
    unsubscribe?.();
  });

  it('sets Lexical text once', async () => {
    renderKimiComposer();

    await kimiAdapter.composer?.setComposerPayload?.({
      text: 'hello',
      attachments: [],
    });

    expect(document.querySelector('.chat-input-editor')?.textContent).toBe(
      'hello',
    );
    expect(document.execCommand).toHaveBeenCalledWith(
      'insertText',
      false,
      'hello',
    );
  });

  itKimiPromptOnly('keeps prompt delivery text-only when attachments are present', async () => {
    renderKimiComposer();

    await kimiAdapter.composer?.setComposerPayload?.({
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

    expect(document.querySelector('.chat-input-editor')?.textContent).toBe(
      'hello',
    );
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('captures source attachment metadata before submit', () => {
    renderKimiComposer();
    const composer = document.querySelector<HTMLElement>('.chat-input-editor');
    if (composer) {
      composer.textContent = 'hello';
    }
    const pasteEvent = new Event('paste', { bubbles: true });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        files: [
          new File(['abc'], 'sample.pdf', { type: 'application/pdf' }),
        ],
        items: [],
      },
    });
    const onSubmit = vi.fn();
    const unsubscribe =
      kimiAdapter.composer?.subscribeToUserSubmissions?.(onSubmit);

    composer?.dispatchEvent(pasteEvent);
    insertKimiFileCard('success', 'sample', 'PDF');
    const sendButton = document.querySelector<HTMLElement>(
      '.send-button-container',
    );
    sendButton?.classList.remove('disabled');
    sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'hello',
        attachments: [
          expect.objectContaining({
            name: 'sample.pdf',
            source: 'paste',
          }),
        ],
        attachmentResolution: expect.objectContaining({
          currentCount: 1,
          submittedCount: 1,
        }),
      }),
    );
    unsubscribe?.();
  });
});

describeKimiAttachmentDelivery('Kimi attachment delivery adapter', () => {
  let rectSpy: ReturnType<typeof vi.spyOn>;
  let uninstallFileInputDeliveryBridge: () => void;

  beforeEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/');
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
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn((command: string, _showUi?: boolean, value?: string) => {
        if (command === 'selectAll') {
          return true;
        }
        const composer =
          document.querySelector<HTMLElement>('.chat-input-editor');
        if (command === 'insertText' && composer) {
          composer.textContent = value ?? '';
          return true;
        }
        if (command === 'delete' && composer) {
          composer.textContent = '';
          return true;
        }
        return false;
      }),
    });
  });

  afterEach(() => {
    uninstallFileInputDeliveryBridge();
    rectSpy.mockRestore();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, 'execCommand');
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/');
  });

  it('sets text and injects reconstructed files through the toolkit file input', async () => {
    renderKimiComposerWithToolkit();

    await kimiAdapter.composer?.setComposerPayload?.({
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

    const input = document.querySelector<HTMLInputElement>(
      '.toolkit-item input[type="file"]',
    );
    expect(input?.files?.[0]).toEqual(expect.any(File));
    expect(input?.files?.[0]?.name).toBe('sample.pdf');
    expect(input?.files?.[0]?.type).toBe('application/pdf');
    expect(document.querySelector('.chat-input-editor')?.textContent).toBe(
      'hello',
    );
  });

  it('reports attachment presence only for ready cards matching expected names', async () => {
    renderKimiComposer();
    insertKimiFileCard('success', 'sample', 'PDF');
    insertKimiFileCard('parsing', 'other', 'TXT');

    const presence = await
    kimiAdapter.composer?.getComposerAttachmentPresence?.([
      { id: 'a1', name: 'sample.pdf', mime: 'application/pdf', size: 3 },
      { id: 'a2', name: 'other.txt', mime: 'text/plain', size: 3 },
    ]);

    expect(presence).toMatchObject({
      count: 1,
      keys: ['sample.pdf'],
    });
    expect(presence?.diagnostic).toContain('file:parsing:other TXT');
  });

  it('matches captured attachments against ready file cards', () => {
    renderKimiComposer();
    insertKimiFileCard('success', 'sample', 'PDF');

    expect(
      kimiAdapter.composer?.getComposerAttachmentSnapshot?.([
        {
          id: 'a1',
          name: 'sample.pdf',
          mime: 'application/pdf',
          size: 3,
          file: new File(['abc'], 'sample.pdf', { type: 'application/pdf' }),
          source: 'file-input',
        },
      ]),
    ).toEqual({
      count: 1,
      items: ['sample.pdf'],
    });
  });

  it('counts ready image thumbnails as attachments', async () => {
    renderKimiComposer();
    insertKimiImageThumbnail('');
    insertKimiImageThumbnail('loading');
    insertKimiImageThumbnail('error');

    const presence = await
    kimiAdapter.composer?.getComposerAttachmentPresence?.([
      { id: 'a1', name: 'shot.png', mime: 'image/png', size: 3 },
      { id: 'a2', name: 'shot-2.png', mime: 'image/png', size: 3 },
    ]);

    expect(presence).toMatchObject({
      count: 1,
      keys: ['shot.png'],
    });
    expect(presence?.diagnostic).toContain('image:loading');
  });

  it('matches mixed file and image attachments independently', () => {
    renderKimiComposer();
    insertKimiFileCard('success', 'sample', 'PDF');
    insertKimiImageThumbnail('');

    expect(
      kimiAdapter.composer?.getComposerAttachmentSnapshot?.([
        {
          id: 'a1',
          name: 'shot.png',
          mime: 'image/png',
          size: 3,
          file: new File(['abc'], 'shot.png', { type: 'image/png' }),
          source: 'paste',
        },
        {
          id: 'a2',
          name: 'sample.pdf',
          mime: 'application/pdf',
          size: 3,
          file: new File(['abc'], 'sample.pdf', { type: 'application/pdf' }),
          source: 'file-input',
        },
      ]),
    ).toEqual({
      count: 2,
      items: ['shot.png', 'sample.pdf'],
    });
  });

  it("captures files dropped onto Kimi's full-page drop mask", () => {
    renderKimiComposer();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div class="drop-file-mask active"><div class="drop-file-box"><div class="drop-area"></div></div></div>',
    );
    const onSubmit = vi.fn();
    const unsubscribe =
      kimiAdapter.composer?.subscribeToUserSubmissions?.(onSubmit);

    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: {
        files: [new File(['abc'], 'dropped.pdf', { type: 'application/pdf' })],
        items: [],
      },
    });
    document.querySelector('.drop-area')?.dispatchEvent(dropEvent);

    insertKimiFileCard('success', 'dropped', 'PDF');
    const sendButton = document.querySelector<HTMLElement>(
      '.send-button-container',
    );
    sendButton?.classList.remove('disabled');
    sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          expect.objectContaining({ name: 'dropped.pdf', source: 'drop' }),
        ],
      }),
    );
    unsubscribe?.();
  });

  it('captures MAIN-world toolkit file signals before button submit', () => {
    renderKimiComposerWithToolkit();
    const composer = document.querySelector<HTMLElement>('.chat-input-editor');
    if (composer) {
      composer.textContent = 'hello';
    }
    const file = new File(['abc'], 'sample.pdf', {
      type: 'application/pdf',
    });
    document
      .querySelector<HTMLElement>('.toolkit-trigger-btn')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const fileInput = document.querySelector<HTMLInputElement>(
      '.toolkit-item input[type="file"]',
    );
    if (!fileInput) {
      throw new Error('expected Kimi toolkit file input');
    }
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [file],
    });
    const onSubmit = vi.fn();
    const unsubscribe =
      kimiAdapter.composer?.subscribeToUserSubmissions?.(onSubmit);

    fileInput?.dispatchEvent(
      new CustomEvent('ask-em:file-input-source-capture', {
        bubbles: true,
      }),
    );
    insertKimiFileCard('success', 'sample', 'PDF');
    const sendButton = document.querySelector<HTMLElement>(
      '.send-button-container',
    );
    sendButton?.classList.remove('disabled');
    sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          expect.objectContaining({
            name: 'sample.pdf',
            source: 'main-file-input',
          }),
        ],
      }),
    );
    unsubscribe?.();
  });

  it('reports draft-restored cards as uncaptured current attachments', () => {
    renderKimiComposer();
    // A card restored from Kimi's persisted draft fires no capture events,
    // so the buffer is empty but the DOM still shows the attachment.
    insertKimiFileCard('success', 'restored-draft', 'PDF');
    const composer = document.querySelector<HTMLElement>('.chat-input-editor');
    if (composer) {
      composer.textContent = 'hello';
    }
    const onSubmit = vi.fn();
    const unsubscribe =
      kimiAdapter.composer?.subscribeToUserSubmissions?.(onSubmit);
    const sendButton = document.querySelector<HTMLElement>(
      '.send-button-container',
    );
    sendButton?.classList.remove('disabled');
    sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [],
        attachmentResolution: expect.objectContaining({
          capturedCount: 0,
          currentCount: 1,
          reason: 'no-captured-attachments',
        }),
      }),
    );
    unsubscribe?.();
  });

  it('detects Kimi error attachment cards', () => {
    renderKimiComposer();
    insertKimiImageThumbnail('error');

    expect(kimiAdapter.composer?.detectAttachmentUploadError?.()).toBe(
      'upload failed',
    );
  });

  it('scopes toolkit popover file inputs to the composer', () => {
    renderKimiComposerWithToolkit();
    document.querySelector<HTMLElement>('.toolkit-trigger-btn')?.click();
    const toolkitInput = document.querySelector<HTMLInputElement>(
      '.toolkit-item input[type="file"]',
    );
    document.body.insertAdjacentHTML(
      'beforeend',
      '<input type="file" id="unrelated" />',
    );
    const unrelatedInput = document.getElementById(
      'unrelated',
    ) as HTMLInputElement;

    expect(kimiAdapter.composer).toBeDefined();
    expect(
      toolkitInput?.closest('.toolkit-popover, .toolkit-item, #chat-box'),
    ).not.toBeNull();
    expect(
      unrelatedInput.closest('.toolkit-popover, .toolkit-item, #chat-box'),
    ).toBeNull();
  });

  it('detects Kimi unsupported-format upload toasts', () => {
    renderKimiComposer();
    document.body.insertAdjacentHTML(
      'beforeend',
      `
      <div class="message-list-container top">
        <div class="message-container">
          <div class="message-content">Uploaded files contain unsupported formats. Please convert and try again.</div>
        </div>
      </div>
    `,
    );

    expect(kimiAdapter.composer?.detectAttachmentUploadError?.()).toBe(
      'upload failed',
    );
  });
});
