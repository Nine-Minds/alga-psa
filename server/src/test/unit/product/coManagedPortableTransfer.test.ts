import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { expect, it, vi } from 'vitest';
import { assertPortableTransferActive, awaitPortableTransfer, createPortableWriteStream, portableTransferSignal, withPortableTransfer } from '../../../../../packages/co-managed/src/portableTransfer';

async function disk(work: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'portable-transfer-test-'));
  try { await work(root); } finally { await rm(root, { recursive: true, force: true }); }
}
const write = (path: string, value: Buffer) => pipeline(Readable.from([value]), createPortableWriteStream(path), { signal: portableTransferSignal() });
it('rejects an elapsed deadline even before the event loop delivers the abort timer', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
  try {
    await expect(withPortableTransfer({ timeoutMs: 100 }, async () => {
      now.mockReturnValue(1100); assertPortableTransferActive();
    })).rejects.toThrow('resource limits');
  } finally { now.mockRestore(); }
});
it('counts temporary writes across files and rejects a write before exceeding the request budget', () => disk(async root => {
  await expect(withPortableTransfer({ maxWrittenBytes: 7 }, async () => {
    await write(join(root, 'first'), Buffer.from('1234'));
    await write(join(root, 'second'), Buffer.from('5678'));
  })).rejects.toThrow('resource limits');
  expect((await readFile(join(root, 'first'))).toString()).toBe('1234');
  expect(await readFile(join(root, 'second'))).toHaveLength(0);
  // A failed writer must not poison the serialized write queue.
  await withPortableTransfer({ maxWrittenBytes: 4 }, () => write(join(root, 'next'), Buffer.from('abcd')));
  expect((await readFile(join(root, 'next'))).toString()).toBe('abcd');
}));
it('preserves configured disk headroom and does not write bytes when it is unavailable', () => disk(async root => {
  await expect(withPortableTransfer({ minFreeBytes: Number.MAX_SAFE_INTEGER }, () => write(join(root, 'denied'), Buffer.from('data')))).rejects.toThrow('resource limits');
  expect(await readFile(join(root, 'denied'))).toHaveLength(0);
}));
it('aborts a stalled source and destroys a provider stream that arrives after cancellation', async () => {
  const abort = new AbortController(); let resolve!: (source: Readable) => void;
  let started!: () => void; const running = new Promise<void>(done => { started = done; });
  const pending = withPortableTransfer({ signal: abort.signal }, () => awaitPortableTransfer(() => {
    started(); return new Promise<Readable>(done => { resolve = done; });
  }, stream => { stream.destroy(); }));
  await running; abort.abort(); await expect(pending).rejects.toThrow('cancelled');
  const late = Readable.from(['late']); resolve(late);
  await new Promise(done => setImmediate(done)); expect(late.destroyed).toBe(true);
});
it('applies a deadline and cancels an already-open pipeline without exposing a successful partial file', () => disk(async root => {
  const source = new Readable({ read() {} });
  await expect(withPortableTransfer({ timeoutMs: 15 }, () => pipeline(source, createPortableWriteStream(join(root, 'stalled')),
    { signal: portableTransferSignal() }))).rejects.toThrow();
  expect(source.destroyed).toBe(true);
  const abort = new AbortController(); abort.abort();
  await expect(withPortableTransfer({ signal: abort.signal }, async () => { throw new Error('Must not run'); })).rejects.toThrow('cancelled');
}));
