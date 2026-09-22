import { describe, expect, it } from 'vitest';
import { createSerialMutationQueue } from './serialMutationQueue';

describe('preference operation serialization', () => {
  it('finishes a category write before a later subtype write and re-entry read', async () => {
    const queue = createSerialMutationQueue();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let values = [true, true];
    const category = queue.enqueue(async () => { await gate; values = [false, false]; });
    const subtype = queue.enqueue(async () => { values[1] = true; });
    const read = queue.enqueue(async () => [...values]);
    await Promise.resolve();
    expect(values).toEqual([true, true]);
    release();
    await Promise.all([category, subtype]);
    expect(await read).toEqual([false, true]);
  });

  it('propagates failure to its owner while allowing recovery and retry', async () => {
    const queue = createSerialMutationQueue();
    const failure = queue.enqueue(async () => { throw new Error('timeout'); });
    const recovered = queue.enqueue(async () => 'saved state');
    await expect(failure).rejects.toThrow('timeout');
    expect(await recovered).toBe('saved state');
    expect(await queue.enqueue(async () => 'retry saved')).toBe('retry saved');
  });
});
