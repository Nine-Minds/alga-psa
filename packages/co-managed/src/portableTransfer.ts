import { AsyncLocalStorage } from 'node:async_hooks';
import { open, statfs, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Writable } from 'node:stream';

export interface PortableTransferOptions { signal?: AbortSignal; maxWrittenBytes?: number; minFreeBytes?: number; timeoutMs?: number }
interface Transfer { deadlineAt: number; signal: AbortSignal; active: boolean; written: number; maxWrittenBytes: number; minFreeBytes: bigint }
const transfers = new AsyncLocalStorage<Transfer>();
const failure = () => new Error('Portable transfer was cancelled or exceeded its resource limits');
const CHUNK = 4 * 1024 ** 2;
let writes: Promise<void> = Promise.resolve();

/** Request-local limits span native/remote staging and archive encryption or
 * extraction. They carry no tenant authority or passphrase. The byte limit
 * counts physical writes, including quarantine and encrypted copies. */
export async function withPortableTransfer<T>(options: PortableTransferOptions, work: () => Promise<T>): Promise<T> {
  if (transfers.getStore()) throw new Error('Portable transfer context is already active');
  const maxWrittenBytes = options.maxWrittenBytes ?? 3 * 1024 ** 4 + 256 * 1024 ** 2, minFreeBytes = options.minFreeBytes ?? 1024 ** 3;
  const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
  if (![maxWrittenBytes, minFreeBytes, timeoutMs].every(Number.isSafeInteger) || maxWrittenBytes < 1 || minFreeBytes < 0 || timeoutMs < 1 || timeoutMs > 30 * 60 * 1000) throw failure();
  const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(), timeoutMs);
  timer.unref?.();
  const state: Transfer = { signal: options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal,
    deadlineAt: Date.now() + timeoutMs, active: true, written: 0, maxWrittenBytes, minFreeBytes: BigInt(minFreeBytes) };
  try { return await transfers.run(state, async () => { assertPortableTransferActive(); const result = await work(); assertPortableTransferActive(); return result; }); }
  finally { state.active = false; clearTimeout(timer); }
}
export function assertPortableTransferActive() {
  const state = transfers.getStore(); if (state && (!state.active || state.signal.aborted || Date.now() >= state.deadlineAt)) throw failure();
}
export function portableTransferSignal() { return transfers.getStore()?.signal; }

/** A storage provider may not accept a signal. Stop awaiting it on cancellation
 * and destroy a stream that arrives later, rather than leaving it unread/open. */
export async function awaitPortableTransfer<T>(start: () => Promise<T>, discard?: (value: T) => void | Promise<void>): Promise<T> {
  assertPortableTransferActive();
  const signal = portableTransferSignal(); if (!signal) return start();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const abort = () => { if (!settled) { settled = true; reject(failure()); } };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { assertPortableTransferActive(); return start(); }).then(async value => {
      if (settled) { await discard?.(value); return; }
      settled = true; resolve(value);
    }, error => { if (!settled) { settled = true; reject(error); } }).catch(() => {}).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

/** Serialize bounded temporary writes in this process and check current free
 * filesystem space immediately before each write. This preserves headroom;
 * it is not a filesystem quota for unrelated applications or other processes. */
export async function writePortableBytes(file: FileHandle, bytes: Uint8Array) {
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    const chunk = bytes.subarray(offset, Math.min(offset + CHUNK, bytes.length)), state = transfers.getStore();
    const write = async () => {
      assertPortableTransferActive();
      if (state) {
        if (state.written + chunk.length > state.maxWrittenBytes) throw failure();
        const space = await statfs(tmpdir(), { bigint: true });
        if (space.bavail * space.bsize < state.minFreeBytes + BigInt(chunk.length)) throw failure();
        assertPortableTransferActive(); state.written += chunk.length;
      }
      let position = 0;
      while (position < chunk.length) {
        assertPortableTransferActive();
        const { bytesWritten } = await file.write(chunk, position, chunk.length - position);
        if (!bytesWritten) throw failure(); position += bytesWritten;
      }
    };
    const pending = writes.then(write); writes = pending.catch(() => {}); await pending;
  }
}

export function createPortableWriteStream(path: string): Writable {
  let file: FileHandle | undefined, closing: Promise<void> | undefined;
  const close = () => closing ??= file ? file.close() : Promise.resolve();
  return new Writable({
    construct(callback) {
      try { assertPortableTransferActive(); } catch (error) { callback(error as Error); return; }
      open(path, 'wx', 0o600).then(value => { file = value; callback(); }, callback);
    },
    write(chunk, _encoding, callback) { writePortableBytes(file!, chunk).then(() => callback(), error => callback(error)); },
    final(callback) { close().then(() => callback(), error => callback(error)); },
    destroy(error, callback) { close().then(() => callback(error), closeError => callback(error ?? closeError)); },
  });
}
