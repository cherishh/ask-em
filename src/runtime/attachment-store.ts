import {
  ATTACHMENT_MAX_AGE_MS,
  ATTACHMENT_MAX_COUNT,
  ATTACHMENT_MAX_FILE_BYTES,
  ATTACHMENT_SESSION_BUDGET_BYTES,
  STORAGE_KEYS,
  type AttachmentRef,
} from './protocol';
import type { AttachmentReadChunkResponse } from './messages';

const ATTACHMENT_DB_NAME = 'ask-em-attachments';
const ATTACHMENT_DB_VERSION = 1;
const ATTACHMENT_OBJECT_STORE = 'attachments';

export type AttachmentStatus = 'writing' | 'ready';

export type AttachmentMetadata = {
  ref: AttachmentRef;
  submitId: string;
  ownerTabId: number;
  ownerWorkspaceId?: string;
  createdAt: number;
  status: AttachmentStatus;
  bytesWritten: number;
};

export type AttachmentMetadataState = Record<string, AttachmentMetadata>;

type CreateAttachmentInput = {
  submitId: string;
  ref: AttachmentRef;
  ownerTabId: number | undefined;
  now?: number;
};

type AppendChunkInput = {
  submitId: string;
  attachmentId: string;
  offset: number;
  chunkBase64: string;
};

type FinalizeAttachmentInput = {
  submitId: string;
  attachmentId: string;
};

type ReadChunkInput = {
  attachmentId: string;
  offset: number;
  maxBytes: number;
};

let attachmentDbPromise: Promise<IDBDatabase> | null = null;

function createQueue() {
  let tail = Promise.resolve();

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task, task);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}

const attachmentQueue = createQueue();

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function openAttachmentDb(): Promise<IDBDatabase> {
  if (!attachmentDbPromise) {
    attachmentDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(ATTACHMENT_DB_NAME, ATTACHMENT_DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(ATTACHMENT_OBJECT_STORE)) {
          db.createObjectStore(ATTACHMENT_OBJECT_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Failed to open attachment store'));
    });
  }

  return attachmentDbPromise;
}

async function withAttachmentObjectStore<T>(
  mode: IDBTransactionMode,
  run: (objectStore: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openAttachmentDb();
  const transaction = db.transaction(ATTACHMENT_OBJECT_STORE, mode);
  const done = waitForTransaction(transaction);
  const objectStore = transaction.objectStore(ATTACHMENT_OBJECT_STORE);
  const result = await run(objectStore);
  await done;
  return result;
}

async function getBlob(attachmentId: string): Promise<Blob | null> {
  return withAttachmentObjectStore('readonly', async (objectStore) => {
    const result = await requestToPromise<Blob | undefined>(objectStore.get(attachmentId));
    return result ?? null;
  });
}

async function putBlob(attachmentId: string, blob: Blob): Promise<void> {
  await withAttachmentObjectStore('readwrite', async (objectStore) => {
    await requestToPromise(objectStore.put(blob, attachmentId));
  });
}

async function deleteBlobs(attachmentIds: string[]): Promise<void> {
  if (attachmentIds.length === 0) {
    return;
  }

  await withAttachmentObjectStore('readwrite', async (objectStore) => {
    await Promise.all(attachmentIds.map((attachmentId) => requestToPromise(objectStore.delete(attachmentId))));
  });
}

async function clearBlobs(): Promise<void> {
  await withAttachmentObjectStore('readwrite', async (objectStore) => {
    await requestToPromise(objectStore.clear());
  });
}

async function listBlobIds(): Promise<string[]> {
  return withAttachmentObjectStore('readonly', async (objectStore) => {
    const keys = await requestToPromise<IDBValidKey[]>(objectStore.getAllKeys());
    return keys.filter((key): key is string => typeof key === 'string');
  });
}

async function readMetadataState(): Promise<AttachmentMetadataState> {
  const result = await chrome.storage.session.get(STORAGE_KEYS.attachments);
  return (result[STORAGE_KEYS.attachments] as AttachmentMetadataState | undefined) ?? {};
}

async function writeMetadataState(state: AttachmentMetadataState): Promise<void> {
  if (Object.keys(state).length === 0) {
    await chrome.storage.session.remove(STORAGE_KEYS.attachments);
    return;
  }

  await chrome.storage.session.set({ [STORAGE_KEYS.attachments]: state });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const batchSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += batchSize) {
    const batch = bytes.subarray(offset, offset + batchSize);
    binary += String.fromCharCode(...batch);
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

function getReservedBytes(state: AttachmentMetadataState): number {
  return Object.values(state).reduce((total, metadata) => total + metadata.ref.size, 0);
}

function getSubmitAttachmentCount(state: AttachmentMetadataState, submitId: string): number {
  return Object.values(state).filter((metadata) => metadata.submitId === submitId).length;
}

function validateAttachmentRef(ref: AttachmentRef) {
  if (!ref.id || !ref.name || !ref.mime) {
    throw new Error('Invalid attachment metadata');
  }

  if (!Number.isFinite(ref.size) || ref.size < 0) {
    throw new Error('Invalid attachment size');
  }

  if (ref.size > ATTACHMENT_MAX_FILE_BYTES) {
    throw new Error('attachment too large');
  }
}

async function sweepExpiredFromState(
  state: AttachmentMetadataState,
  now = Date.now(),
): Promise<AttachmentMetadataState> {
  const expiredIds = Object.entries(state)
    .filter(([, metadata]) => now - metadata.createdAt >= ATTACHMENT_MAX_AGE_MS)
    .map(([attachmentId]) => attachmentId);

  if (expiredIds.length === 0) {
    return state;
  }

  const nextState = { ...state };
  for (const attachmentId of expiredIds) {
    delete nextState[attachmentId];
  }

  await deleteBlobs(expiredIds);
  return nextState;
}

async function deleteMetadataEntries(
  state: AttachmentMetadataState,
  attachmentIds: string[],
): Promise<AttachmentMetadataState> {
  if (attachmentIds.length === 0) {
    return state;
  }

  const nextState = { ...state };
  for (const attachmentId of attachmentIds) {
    delete nextState[attachmentId];
  }

  await deleteBlobs(attachmentIds);
  return nextState;
}

export async function createAttachment(input: CreateAttachmentInput): Promise<AttachmentRef> {
  return attachmentQueue.run(async () => {
    if (typeof input.ownerTabId !== 'number') {
      throw new Error('Attachment owner tab is required');
    }

    validateAttachmentRef(input.ref);

    const now = input.now ?? Date.now();
    const currentState = await readMetadataState();
    const sweptState = await sweepExpiredFromState(currentState, now);

    if (sweptState[input.ref.id]) {
      throw new Error('Attachment already exists');
    }

    if (getSubmitAttachmentCount(sweptState, input.submitId) >= ATTACHMENT_MAX_COUNT) {
      throw new Error('too many files');
    }

    if (getReservedBytes(sweptState) + input.ref.size > ATTACHMENT_SESSION_BUDGET_BYTES) {
      throw new Error('attachment budget exceeded');
    }

    const nextState: AttachmentMetadataState = {
      ...sweptState,
      [input.ref.id]: {
        ref: input.ref,
        submitId: input.submitId,
        ownerTabId: input.ownerTabId,
        createdAt: now,
        status: 'writing',
        bytesWritten: 0,
      },
    };

    await writeMetadataState(nextState);
    return input.ref;
  });
}

export async function appendAttachmentChunk(input: AppendChunkInput): Promise<AttachmentMetadata> {
  return attachmentQueue.run(async () => {
    const state = await readMetadataState();
    const metadata = state[input.attachmentId];

    if (!metadata || metadata.submitId !== input.submitId) {
      throw new Error('Attachment not found');
    }

    if (metadata.status !== 'writing') {
      throw new Error('Attachment is not writable');
    }

    if (input.offset !== metadata.bytesWritten) {
      throw new Error('Attachment chunk offset mismatch');
    }

    const bytes = base64ToBytes(input.chunkBase64);
    const nextBytesWritten = metadata.bytesWritten + bytes.byteLength;

    if (nextBytesWritten > metadata.ref.size) {
      throw new Error('Attachment chunk exceeds declared size');
    }

    const existingBlob = await getBlob(input.attachmentId);
    const chunk = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const nextBlob = new Blob(existingBlob ? [existingBlob, chunk] : [chunk], {
      type: metadata.ref.mime,
    });
    await putBlob(input.attachmentId, nextBlob);

    const nextMetadata: AttachmentMetadata = {
      ...metadata,
      bytesWritten: nextBytesWritten,
    };

    await writeMetadataState({
      ...state,
      [input.attachmentId]: nextMetadata,
    });

    return nextMetadata;
  });
}

export async function finalizeAttachment(input: FinalizeAttachmentInput): Promise<AttachmentRef> {
  return attachmentQueue.run(async () => {
    const state = await readMetadataState();
    const metadata = state[input.attachmentId];

    if (!metadata || metadata.submitId !== input.submitId) {
      throw new Error('Attachment not found');
    }

    if (metadata.bytesWritten !== metadata.ref.size) {
      throw new Error('Attachment is incomplete');
    }

    if (metadata.ref.size === 0 && !(await getBlob(input.attachmentId))) {
      await putBlob(input.attachmentId, new Blob([], { type: metadata.ref.mime }));
    }

    const nextMetadata: AttachmentMetadata = {
      ...metadata,
      status: 'ready',
    };

    await writeMetadataState({
      ...state,
      [input.attachmentId]: nextMetadata,
    });

    return metadata.ref;
  });
}

export async function bindAttachments(submitId: string, workspaceId: string): Promise<void> {
  await attachmentQueue.run(async () => {
    const state = await readMetadataState();
    let changed = false;
    const nextState: AttachmentMetadataState = {};

    for (const [attachmentId, metadata] of Object.entries(state)) {
      if (metadata.submitId !== submitId) {
        nextState[attachmentId] = metadata;
        continue;
      }

      changed = true;
      nextState[attachmentId] = {
        ...metadata,
        ownerWorkspaceId: workspaceId,
      };
    }

    if (changed) {
      await writeMetadataState(nextState);
    }
  });
}

export async function readAttachmentChunk(input: ReadChunkInput): Promise<AttachmentReadChunkResponse> {
  return attachmentQueue.run(async () => {
    const state = await readMetadataState();
    const metadata = state[input.attachmentId];

    if (!metadata) {
      throw new Error('Attachment not found');
    }

    if (metadata.status !== 'ready') {
      throw new Error('Attachment is not ready');
    }

    if (input.offset < 0 || input.maxBytes <= 0) {
      throw new Error('Invalid attachment read range');
    }

    const blob = await getBlob(input.attachmentId);
    if (!blob) {
      throw new Error('Attachment bytes not found');
    }

    const start = Math.min(input.offset, blob.size);
    const end = Math.min(start + input.maxBytes, blob.size);
    const bytes = new Uint8Array(await blob.slice(start, end).arrayBuffer());

    return {
      attachmentId: input.attachmentId,
      offset: start,
      nextOffset: end,
      chunkBase64: bytesToBase64(bytes),
      done: end >= blob.size,
    };
  });
}

export async function releaseSubmitAttachments(submitId: string): Promise<void> {
  await attachmentQueue.run(async () => {
    const state = await readMetadataState();
    const attachmentIds = Object.entries(state)
      .filter(([, metadata]) => metadata.submitId === submitId)
      .map(([attachmentId]) => attachmentId);
    const nextState = await deleteMetadataEntries(state, attachmentIds);
    await writeMetadataState(nextState);
  });
}

export async function abortAttachments(input: { submitId: string } | { ids: string[] }): Promise<void> {
  await attachmentQueue.run(async () => {
    const state = await readMetadataState();
    const attachmentIds = 'submitId' in input
      ? Object.entries(state)
        .filter(([, metadata]) => metadata.submitId === input.submitId)
        .map(([attachmentId]) => attachmentId)
      : input.ids;
    const nextState = await deleteMetadataEntries(state, attachmentIds);
    await writeMetadataState(nextState);
  });
}

export async function sweepExpiredAttachments(now = Date.now()): Promise<number> {
  return attachmentQueue.run(async () => {
    const state = await readMetadataState();
    const nextState = await sweepExpiredFromState(state, now);
    await writeMetadataState(nextState);
    return Object.keys(state).length - Object.keys(nextState).length;
  });
}

export async function sweepOrphanAttachmentBlobs(): Promise<number> {
  return attachmentQueue.run(async () => {
    const [state, blobIds] = await Promise.all([readMetadataState(), listBlobIds()]);
    const orphanIds = blobIds.filter((blobId) => !state[blobId]);
    await deleteBlobs(orphanIds);
    return orphanIds.length;
  });
}

export async function startupSweepAttachments(now = Date.now()): Promise<void> {
  await sweepExpiredAttachments(now);
  await sweepOrphanAttachmentBlobs();
}

export async function sweepAttachmentsByOwnerTab(tabId: number): Promise<number> {
  return attachmentQueue.run(async () => {
    const state = await readMetadataState();
    const attachmentIds = Object.entries(state)
      .filter(([, metadata]) => metadata.ownerTabId === tabId)
      .map(([attachmentId]) => attachmentId);
    const nextState = await deleteMetadataEntries(state, attachmentIds);
    await writeMetadataState(nextState);
    return attachmentIds.length;
  });
}

export async function clearAllAttachments(): Promise<void> {
  await attachmentQueue.run(async () => {
    await Promise.all([
      chrome.storage.session.remove(STORAGE_KEYS.attachments),
      clearBlobs(),
    ]);
  });
}

export async function getReservedAttachmentBytes(): Promise<number> {
  return attachmentQueue.run(async () => getReservedBytes(await readMetadataState()));
}

export async function getAttachmentMetadata(attachmentId: string): Promise<AttachmentMetadata | null> {
  return attachmentQueue.run(async () => {
    const state = await readMetadataState();
    return state[attachmentId] ?? null;
  });
}
