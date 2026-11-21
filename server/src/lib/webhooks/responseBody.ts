export const MAX_WEBHOOK_RESPONSE_BODY_CHARS = 8 * 1024;

/**
 * Read only enough of an HTTP response body to produce the captured text.
 * Undici exposes the body after content decoding, so this limit also applies
 * to compressed responses after decompression.
 */
export async function readBoundedResponseText(
  body: ReadableStream<Uint8Array> | null,
  maxChars: number,
  signal: AbortSignal,
): Promise<string> {
  if (!body || maxChars <= 0) {
    await body?.cancel().catch(() => undefined);
    if (signal.aborted) throw signal.reason;
    return '';
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        text += decoder.decode();
        if (signal.aborted) throw signal.reason;
        return text.slice(0, maxChars);
      }

      let offset = 0;
      while (offset < value.length && text.length < maxChars) {
        // A UTF-8 byte can produce at most one UTF-16 code unit. Feeding no
        // more than the remaining character budget keeps decoded strings
        // bounded even when a decompressor emits a very large chunk.
        const nextOffset = Math.min(offset + maxChars - text.length, value.length);
        text += decoder.decode(value.subarray(offset, nextOffset), { stream: true });
        offset = nextOffset;
      }

      if (text.length >= maxChars) {
        const captured = text.slice(0, maxChars);
        await reader.cancel().catch(() => undefined);
        if (signal.aborted) throw signal.reason;
        return captured;
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
