/** Serialize preference operations across panel unmount/re-entry as well as clicks. */
export function createSerialMutationQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    enqueue<T>(operation: () => Promise<T>): Promise<T> {
      const result = tail.then(operation);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
