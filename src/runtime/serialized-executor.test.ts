import { describe, expect, it } from 'vitest';
import { createSerializedExecutor } from './serialized-executor';

function defer() {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

describe('serialized executor', () => {
  it('runs queued tasks one at a time in submission order', async () => {
    const runSerialized = createSerializedExecutor();
    const firstGate = defer();
    const events: string[] = [];

    const firstTask = runSerialized(async () => {
      events.push('first:start');
      await firstGate.promise;
      events.push('first:end');
      return 'first';
    });

    const secondTask = runSerialized(async () => {
      events.push('second:start');
      events.push('second:end');
      return 'second';
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(['first:start']);

    firstGate.resolve();

    await expect(firstTask).resolves.toBe('first');
    await expect(secondTask).resolves.toBe('second');
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('keeps processing the queue after a task rejects', async () => {
    const runSerialized = createSerializedExecutor();
    const events: string[] = [];

    const failingTask = runSerialized(async () => {
      events.push('fail:start');
      throw new Error('boom');
    });

    const nextTask = runSerialized(async () => {
      events.push('next:start');
      events.push('next:end');
      return 'ok';
    });

    await expect(failingTask).rejects.toThrow('boom');
    await expect(nextTask).resolves.toBe('ok');
    expect(events).toEqual(['fail:start', 'next:start', 'next:end']);
  });
});
