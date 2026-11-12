import { describe, expect, it } from 'vitest';
import { UploadSizeLimitError } from '../src/ingest/errors';
import {
  SERVER_ACTION_ENVELOPE_BYTES,
  assertWithinBufferedCap,
  effectiveBufferedCap,
  parseByteSize,
  serverActionFileLimitBytes,
} from '../src/ingest/bufferedCap';

describe('buffered upload caps', () => {
  it('never exceeds the provider max', () => {
    expect(effectiveBufferedCap(100, 500)).toBe(100);
    expect(effectiveBufferedCap(100, 40)).toBe(40);
  });

  it('throws the ingest size error (413) past the cap and passes at it', () => {
    expect(() => assertWithinBufferedCap(10, 10)).not.toThrow();
    try {
      assertWithinBufferedCap(11, 10);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(UploadSizeLimitError);
      expect((error as UploadSizeLimitError).status).toBe(413);
      expect((error as Error).message).toBe('File size exceeds limit of 10 bytes');
    }
  });

  it('parses Next-style size strings', () => {
    expect(parseByteSize('20mb')).toBe(20 * 1024 * 1024);
    expect(parseByteSize('1.5 GB')).toBe(1.5 * 1024 ** 3);
    expect(parseByteSize('4096')).toBe(4096);
    expect(parseByteSize('lots')).toBeNull();
  });

  it('the server-action file limit is the body limit less the envelope, defaulting to 20mb', () => {
    expect(serverActionFileLimitBytes('20mb')).toBe(20 * 1024 * 1024 - SERVER_ACTION_ENVELOPE_BYTES);
    expect(serverActionFileLimitBytes('1mb')).toBe(1024 * 1024 - SERVER_ACTION_ENVELOPE_BYTES);
    expect(serverActionFileLimitBytes('nonsense')).toBe(20 * 1024 * 1024 - SERVER_ACTION_ENVELOPE_BYTES);
    expect(serverActionFileLimitBytes('10b')).toBe(0);
  });
});
