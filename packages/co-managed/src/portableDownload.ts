import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';

export interface PortableDownloadArtifact { packageId: string; sourceTenant: string; capturedAt: string; path: string; size: number; sha256: string }

/** The provider is an internal, single-use current-authority boundary. Its
 * callback opens the sealed regular file while admission locks are retained.
 * Only after that boundary commits may the descriptor stream to the browser.
 * Unlinking the private path after admission leaves this descriptor usable;
 * completion, cancellation or errors close it and release the disk allocation.
 * This is download admission, not continuing live access to source records. */
export async function acquirePortableDownload(consume: <T>(work: (artifact: PortableDownloadArtifact) => Promise<T>) => Promise<T>, signal?: AbortSignal) {
  let handle: FileHandle | undefined;
  try {
    const artifact = await consume(async source => {
      if (signal?.aborted) throw new Error('Portable download cancelled');
      handle = await open(source.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || !Number.isSafeInteger(source.size) || source.size < 0 || stat.size !== source.size) throw new Error('Portable download is unavailable');
      const { path: _path, ...metadata } = source;
      return metadata;
    });
    const file = handle!;
    let closed = false, position = 0, closing: Promise<void> | undefined;
    const close = () => {
      if (!closing) { closed = true; signal?.removeEventListener('abort', abort); closing = file.close(); }
      return closing;
    };
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const abort = () => { if (!closed) { controller.error(new Error('Portable download cancelled')); void close().catch(() => {}); } };
    const stream = new ReadableStream<Uint8Array>({
      start(value) { controller = value; signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort(); },
      async pull(value) {
        if (closed) return;
        try {
          if (position === artifact.size) { await close(); value.close(); return; }
          const bytes = new Uint8Array(Math.min(64 * 1024, artifact.size - position));
          const result = await file.read(bytes, 0, bytes.length, position);
          if (closed) return;
          if (!result.bytesRead) throw new Error('Portable download is incomplete');
          position += result.bytesRead; value.enqueue(bytes.subarray(0, result.bytesRead));
        } catch { if (!closed) value.error(new Error('Portable download failed')); await close(); }
      },
      cancel() { return close(); },
    }, { highWaterMark: 0 });
    return { ...artifact, stream, dispose: close };
  } catch (error) { await handle?.close(); throw error; }
}
