// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import {
  ASK_EM_BRIDGE_SOURCE,
  ASK_EM_FILE_INPUT_DELIVERY,
  ASK_EM_FILE_INPUT_DELIVERY_RESULT,
  ASK_EM_FILE_INPUT_TOKEN_ATTRIBUTE,
  type AskEmFileInputDeliveryMessage,
  isAskEmFileInputDeliveryResultMessage,
} from '../runtime/protocol';
import { installFileInputDeliveryBridge } from './file-input-delivery-main';

function waitForResult(requestId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const listener = (event: MessageEvent) => {
      if (!isAskEmFileInputDeliveryResultMessage(event.data) || event.data.requestId !== requestId) {
        return;
      }

      window.removeEventListener('message', listener);
      resolve(event.data.ok);
    };

    window.addEventListener('message', listener);
  });
}

describe('file input delivery bridge', () => {
  let cleanup: (() => void) | null = null;

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    document.body.innerHTML = '';
  });

  it('passes native files through the page world bridge', async () => {
    cleanup = installFileInputDeliveryBridge();
    document.body.innerHTML = `<input type="file" ${ASK_EM_FILE_INPUT_TOKEN_ATTRIBUTE}="request-native" />`;
    const input = document.querySelector('input') as HTMLInputElement;
    const file = new File(['native'], 'native.txt', { type: 'text/plain' });
    const result = waitForResult('request-native');

    window.postMessage({
      source: ASK_EM_BRIDGE_SOURCE,
      type: ASK_EM_FILE_INPUT_DELIVERY,
      requestId: 'request-native',
      inputToken: 'request-native',
      encoding: 'native',
      files: [file],
    } satisfies AskEmFileInputDeliveryMessage, '*');

    await expect(result).resolves.toBe(true);
    expect(input.files?.[0]?.name).toBe('native.txt');
    await expect(input.files?.[0]?.text()).resolves.toBe('native');
  });

  it('reconstructs serialized files and dispatches change', async () => {
    cleanup = installFileInputDeliveryBridge();
    document.body.innerHTML = `<input type="file" ${ASK_EM_FILE_INPUT_TOKEN_ATTRIBUTE}="request-1" />`;
    const input = document.querySelector('input') as HTMLInputElement;
    let sawChange = false;
    input.addEventListener('change', () => {
      sawChange = true;
    });

    const result = waitForResult('request-1');
    window.postMessage({
      source: ASK_EM_BRIDGE_SOURCE,
      type: ASK_EM_FILE_INPUT_DELIVERY,
      requestId: 'request-1',
      inputToken: 'request-1',
      encoding: 'serialized',
      files: [{
        name: 'sample.pdf',
        type: 'application/pdf',
        lastModified: 123,
        bytes: new TextEncoder().encode('abc').buffer,
      }],
    } satisfies AskEmFileInputDeliveryMessage, '*');

    await expect(result).resolves.toBe(true);
    expect(sawChange).toBe(true);
    expect(input.files?.[0]?.name).toBe('sample.pdf');
    expect(input.files?.[0]?.type).toBe('application/pdf');
    expect(input.files?.[0]?.lastModified).toBe(123);
    await expect(input.files?.[0]?.text()).resolves.toBe('abc');
  });

  it('reports missing tokenized inputs', async () => {
    cleanup = installFileInputDeliveryBridge();

    const result = new Promise<string | undefined>((resolve) => {
      const listener = (event: MessageEvent) => {
        if (
          event.data?.type !== ASK_EM_FILE_INPUT_DELIVERY_RESULT ||
          event.data?.requestId !== 'request-2'
        ) {
          return;
        }

        window.removeEventListener('message', listener);
        resolve(event.data.error);
      };
      window.addEventListener('message', listener);
    });

    window.postMessage({
      source: ASK_EM_BRIDGE_SOURCE,
      type: ASK_EM_FILE_INPUT_DELIVERY,
      requestId: 'request-2',
      inputToken: 'missing',
      encoding: 'native',
      files: [new File(['abc'], 'sample.pdf', { type: 'application/pdf' })],
    } satisfies AskEmFileInputDeliveryMessage, '*');

    await expect(result).resolves.toBe('upload input not found');
  });
});
