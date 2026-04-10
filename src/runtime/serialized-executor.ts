export type SerializedExecutor = <T>(task: () => Promise<T>) => Promise<T>;

export function createSerializedExecutor(): SerializedExecutor {
  let tail = Promise.resolve();

  return async function runSerialized<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.catch(() => undefined).then(task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
