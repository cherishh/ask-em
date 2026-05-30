import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ATTACHMENT_MAX_AGE_MS,
  ATTACHMENT_MAX_FILE_BYTES,
  ATTACHMENT_MAX_COUNT,
  ATTACHMENT_SESSION_BUDGET_BYTES,
  STORAGE_KEYS,
  type AttachmentRef,
} from './protocol';

function createStorageArea() {
  const state = new Map<string, unknown>();

  return {
    state,
    area: {
      async get(key: string) {
        return { [key]: state.get(key) };
      },
      async set(value: Record<string, unknown>) {
        for (const [key, nextValue] of Object.entries(value)) {
          state.set(key, nextValue);
        }
      },
      async remove(key: string) {
        state.delete(key);
      },
    },
  };
}

function createRequest<T>() {
  return {
    result: undefined as T,
    error: null,
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
  };
}

function succeed<T>(request: ReturnType<typeof createRequest<T>>, result: T) {
  queueMicrotask(() => {
    request.result = result;
    request.onsuccess?.();
  });
}

function createFakeIndexedDb() {
  const data = new Map<string, Blob>();

  const db = {
    objectStoreNames: {
      contains: () => true,
    },
    createObjectStore: vi.fn(),
    transaction() {
      const transaction = {
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
        error: null,
        completed: false,
        completeSoon() {
          if (this.completed) {
            return;
          }
          this.completed = true;
          queueMicrotask(() => {
            queueMicrotask(() => this.oncomplete?.());
          });
        },
        objectStore() {
          return {
            get: (key: string) => {
              const request = createRequest<Blob | undefined>();
              succeed(request, data.get(key));
              transaction.completeSoon();
              return request;
            },
            put: (value: Blob, key: string) => {
              const request = createRequest<IDBValidKey>();
              data.set(key, value);
              succeed(request, key);
              transaction.completeSoon();
              return request;
            },
            delete: (key: string) => {
              const request = createRequest<undefined>();
              data.delete(key);
              succeed(request, undefined);
              transaction.completeSoon();
              return request;
            },
            clear: () => {
              const request = createRequest<undefined>();
              data.clear();
              succeed(request, undefined);
              transaction.completeSoon();
              return request;
            },
            getAllKeys: () => {
              const request = createRequest<IDBValidKey[]>();
              succeed(request, Array.from(data.keys()));
              transaction.completeSoon();
              return request;
            },
          };
        },
      };
      return transaction;
    },
  };

  const factory = {
    open: vi.fn(() => {
      const request = {
        ...createRequest<typeof db>(),
        onupgradeneeded: null as (() => void) | null,
      };
      queueMicrotask(() => {
        request.result = db;
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    }),
  };

  return {
    data,
    factory,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function makeRef(overrides: Partial<AttachmentRef> = {}): AttachmentRef {
  return {
    id: 'a1',
    name: 'file.bin',
    mime: 'application/octet-stream',
    size: 4,
    ...overrides,
  };
}

describe('attachment store', () => {
  let sessionStorage: ReturnType<typeof createStorageArea>;
  let indexedDb: ReturnType<typeof createFakeIndexedDb>;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();

    sessionStorage = createStorageArea();
    indexedDb = createFakeIndexedDb();

    vi.stubGlobal('indexedDB', indexedDb.factory);
    vi.stubGlobal('chrome', {
      storage: {
        session: sessionStorage.area,
      },
    });
  });

  it('writes and reads base64 chunks as raw blob bytes', async () => {
    const store = await import('./attachment-store');
    const bytes = new Uint8Array([0, 1, 2, 255]);

    await store.createAttachment({
      submitId: 'submit-1',
      ref: makeRef({ size: bytes.byteLength }),
      ownerTabId: 9,
    });
    await store.appendAttachmentChunk({
      submitId: 'submit-1',
      attachmentId: 'a1',
      offset: 0,
      chunkBase64: bytesToBase64(bytes.subarray(0, 2)),
    });
    await store.appendAttachmentChunk({
      submitId: 'submit-1',
      attachmentId: 'a1',
      offset: 2,
      chunkBase64: bytesToBase64(bytes.subarray(2)),
    });
    await store.finalizeAttachment({
      submitId: 'submit-1',
      attachmentId: 'a1',
    });

    const first = await store.readAttachmentChunk({
      attachmentId: 'a1',
      offset: 0,
      maxBytes: 2,
    });
    const second = await store.readAttachmentChunk({
      attachmentId: 'a1',
      offset: first.nextOffset,
      maxBytes: 2,
    });

    expect(Array.from(base64ToBytes(first.chunkBase64))).toEqual([0, 1]);
    expect(Array.from(base64ToBytes(second.chunkBase64))).toEqual([2, 255]);
    expect(second.done).toBe(true);
    expect(indexedDb.data.get('a1')?.size).toBe(4);
  });

  it('defers the IndexedDB blob write until finalize (no per-chunk re-put)', async () => {
    const store = await import('./attachment-store');

    await store.createAttachment({
      submitId: 'submit-1',
      ref: makeRef({ size: 4 }),
      ownerTabId: 9,
    });
    await store.appendAttachmentChunk({
      submitId: 'submit-1',
      attachmentId: 'a1',
      offset: 0,
      chunkBase64: bytesToBase64(new Uint8Array([1, 2])),
    });
    await store.appendAttachmentChunk({
      submitId: 'submit-1',
      attachmentId: 'a1',
      offset: 2,
      chunkBase64: bytesToBase64(new Uint8Array([3, 4])),
    });

    // Bytes accumulate in memory; nothing is persisted to IndexedDB mid-write.
    expect(indexedDb.data.has('a1')).toBe(false);

    await store.finalizeAttachment({ submitId: 'submit-1', attachmentId: 'a1' });

    expect(indexedDb.data.get('a1')?.size).toBe(4);
  });

  it('binds metadata to a workspace and releases metadata plus blob by submitId', async () => {
    const store = await import('./attachment-store');

    await store.createAttachment({
      submitId: 'submit-1',
      ref: makeRef(),
      ownerTabId: 9,
    });
    await store.appendAttachmentChunk({
      submitId: 'submit-1',
      attachmentId: 'a1',
      offset: 0,
      chunkBase64: bytesToBase64(new Uint8Array([1, 2, 3, 4])),
    });
    await store.finalizeAttachment({ submitId: 'submit-1', attachmentId: 'a1' });
    await store.bindAttachments('submit-1', 'w1');

    expect(await store.getAttachmentMetadata('a1')).toMatchObject({
      submitId: 'submit-1',
      ownerTabId: 9,
      ownerWorkspaceId: 'w1',
      status: 'ready',
    });

    await store.releaseSubmitAttachments('submit-1');

    expect(await store.getAttachmentMetadata('a1')).toBeNull();
    expect(indexedDb.data.has('a1')).toBe(false);
  });

  it('aborts partial writes immediately', async () => {
    const store = await import('./attachment-store');

    await store.createAttachment({
      submitId: 'submit-1',
      ref: makeRef(),
      ownerTabId: 9,
    });
    await store.appendAttachmentChunk({
      submitId: 'submit-1',
      attachmentId: 'a1',
      offset: 0,
      chunkBase64: bytesToBase64(new Uint8Array([1, 2])),
    });

    await store.abortAttachments({ submitId: 'submit-1' });

    expect(await store.getAttachmentMetadata('a1')).toBeNull();
    expect(indexedDb.data.has('a1')).toBe(false);
  });

  it('sweeps expired entries before reserving create budget', async () => {
    const store = await import('./attachment-store');
    const firstRef = makeRef({ id: 'old-1', size: ATTACHMENT_MAX_FILE_BYTES });
    const secondRef = makeRef({ id: 'old-2', size: ATTACHMENT_MAX_FILE_BYTES });

    await store.createAttachment({
      submitId: 'old-submit',
      ref: firstRef,
      ownerTabId: 9,
      now: 0,
    });
    await store.createAttachment({
      submitId: 'old-submit',
      ref: secondRef,
      ownerTabId: 9,
      now: 0,
    });

    await store.createAttachment({
      submitId: 'new-submit',
      ref: makeRef({ id: 'new-1', size: 1 }),
      ownerTabId: 9,
      now: ATTACHMENT_MAX_AGE_MS,
    });

    expect(await store.getAttachmentMetadata('old-1')).toBeNull();
    expect(await store.getAttachmentMetadata('old-2')).toBeNull();
    expect(await store.getAttachmentMetadata('new-1')).toMatchObject({
      submitId: 'new-submit',
    });
    expect(await store.getReservedAttachmentBytes()).toBe(1);
  });

  it('rejects over-limit creates and non-ready reads', async () => {
    const store = await import('./attachment-store');

    await expect(
      store.createAttachment({
        submitId: 'submit-1',
        ref: makeRef({ size: ATTACHMENT_MAX_FILE_BYTES + 1 }),
        ownerTabId: 9,
      }),
    ).rejects.toThrow('attachment too large');

    await store.createAttachment({
      submitId: 'submit-1',
      ref: makeRef({ id: 'a1', size: ATTACHMENT_MAX_FILE_BYTES }),
      ownerTabId: 9,
    });
    await store.createAttachment({
      submitId: 'submit-1',
      ref: makeRef({ id: 'a2', size: ATTACHMENT_SESSION_BUDGET_BYTES - ATTACHMENT_MAX_FILE_BYTES }),
      ownerTabId: 9,
    });
    await expect(
      store.createAttachment({
        submitId: 'submit-2',
        ref: makeRef({ id: 'a3', size: 1 }),
        ownerTabId: 9,
      }),
    ).rejects.toThrow('attachment budget exceeded');

    await expect(
      store.readAttachmentChunk({
        attachmentId: 'a1',
        offset: 0,
        maxBytes: 1,
      }),
    ).rejects.toThrow('Attachment is not ready');
  });

  it('rejects creates above the per-submit count limit', async () => {
    const store = await import('./attachment-store');

    for (let index = 0; index < ATTACHMENT_MAX_COUNT; index += 1) {
      await store.createAttachment({
        submitId: 'submit-1',
        ref: makeRef({ id: `a-${index}`, size: 1 }),
        ownerTabId: 9,
      });
    }

    await expect(
      store.createAttachment({
        submitId: 'submit-1',
        ref: makeRef({ id: 'one-too-many', size: 1 }),
        ownerTabId: 9,
      }),
    ).rejects.toThrow('too many files');
  });

  it('startup sweep removes orphan blobs', async () => {
    const store = await import('./attachment-store');

    await store.createAttachment({
      submitId: 'submit-1',
      ref: makeRef(),
      ownerTabId: 9,
    });
    await store.appendAttachmentChunk({
      submitId: 'submit-1',
      attachmentId: 'a1',
      offset: 0,
      chunkBase64: bytesToBase64(new Uint8Array([1, 2, 3, 4])),
    });
    sessionStorage.state.delete(STORAGE_KEYS.attachments);

    await store.startupSweepAttachments();

    expect(indexedDb.data.has('a1')).toBe(false);
  });

  it('startup sweep drains restart-abandoned metadata and orphan blobs after TTL', async () => {
    const store = await import('./attachment-store');

    await store.createAttachment({
      submitId: 'writing-submit',
      ref: makeRef({ id: 'writing-a', size: 4 }),
      ownerTabId: 9,
      now: 0,
    });
    await store.appendAttachmentChunk({
      submitId: 'writing-submit',
      attachmentId: 'writing-a',
      offset: 0,
      chunkBase64: bytesToBase64(new Uint8Array([1, 2])),
    });
    await store.createAttachment({
      submitId: 'ready-submit',
      ref: makeRef({ id: 'ready-a', size: 0 }),
      ownerTabId: 9,
      now: 0,
    });
    await store.finalizeAttachment({ submitId: 'ready-submit', attachmentId: 'ready-a' });
    indexedDb.data.set('orphan-a', new Blob([new Uint8Array([9])]));

    await expect(store.readAttachmentChunk({
      attachmentId: 'writing-a',
      offset: 0,
      maxBytes: 1,
    })).rejects.toThrow('Attachment is not ready');

    await expect(store.startupSweepAttachments(ATTACHMENT_MAX_AGE_MS)).resolves.toEqual({
      expired: 2,
      orphaned: 1,
    });

    expect(await store.getAttachmentMetadata('writing-a')).toBeNull();
    expect(await store.getAttachmentMetadata('ready-a')).toBeNull();
    expect(indexedDb.data.size).toBe(0);
    expect(await store.getReservedAttachmentBytes()).toBe(0);
  });

  it('clears only writing attachments for owner tab close and persistent storage reset', async () => {
    const store = await import('./attachment-store');

    await store.createAttachment({
      submitId: 'submit-1',
      ref: makeRef({ id: 'a1' }),
      ownerTabId: 9,
    });
    await store.bindAttachments('submit-1', 'w1');
    await store.createAttachment({
      submitId: 'submit-4',
      ref: makeRef({ id: 'a4' }),
      ownerTabId: 9,
    });
    await store.appendAttachmentChunk({
      submitId: 'submit-4',
      attachmentId: 'a4',
      offset: 0,
      chunkBase64: bytesToBase64(new Uint8Array([1, 2, 3, 4])),
    });
    await store.finalizeAttachment({ submitId: 'submit-4', attachmentId: 'a4' });
    await store.createAttachment({
      submitId: 'submit-3',
      ref: makeRef({ id: 'a3' }),
      ownerTabId: 9,
    });
    await store.createAttachment({
      submitId: 'submit-2',
      ref: makeRef({ id: 'a2' }),
      ownerTabId: 10,
    });

    expect(await store.sweepAttachmentsByOwnerTab(9)).toBe(1);
    expect(await store.getAttachmentMetadata('a1')).not.toBeNull();
    expect(await store.getAttachmentMetadata('a4')).not.toBeNull();
    expect(await store.getAttachmentMetadata('a3')).toBeNull();
    expect(await store.getAttachmentMetadata('a2')).not.toBeNull();

    await store.clearAllAttachments();

    expect(sessionStorage.state.has(STORAGE_KEYS.attachments)).toBe(false);
    expect(indexedDb.data.size).toBe(0);
  });
});
