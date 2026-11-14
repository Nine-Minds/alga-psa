import { describe, expect, it, vi } from 'vitest';
import { UploadSizeLimitError } from '../src/ingest/errors';
import {
  NEXT_PROXY_MAX_BODY_BYTES,
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

  it('fails fast on a cap that is NaN, zero, negative or infinite instead of disabling the limit', () => {
    for (const bad of [NaN, 0, -1, Infinity]) {
      expect(() => effectiveBufferedCap(bad, 500)).toThrow(/must be a finite number of bytes greater than 0/);
      expect(() => effectiveBufferedCap(100, bad)).toThrow(/storage provider maxFileSize/);
      expect(() => assertWithinBufferedCap(1, bad)).toThrow(/greater than 0/);
    }
    expect(() => effectiveBufferedCap(Number('10MB'), 500, 'WORKFLOW_ACTION_ATTACHMENT_MAX_BYTES')).toThrow(/WORKFLOW_ACTION_ATTACHMENT_MAX_BYTES/);
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

  it('the server-action file limit defaults to 26mb (DEFAULT_SERVER_ACTIONS_BODY_LIMIT) when the env var is unset, and throws on a bad one', () => {
    vi.stubEnv('SERVER_ACTIONS_BODY_LIMIT', '');
    expect(serverActionFileLimitBytes()).toBe(26 * 1024 * 1024 - SERVER_ACTION_ENVELOPE_BYTES);
    vi.stubEnv('SERVER_ACTIONS_BODY_LIMIT', '20 megs');
    expect(() => serverActionFileLimitBytes()).toThrow(/SERVER_ACTIONS_BODY_LIMIT must be a size/);
    vi.unstubAllEnvs();
  });

  it('the server-action file limit is the body limit less the envelope, never above the 100 MB proxy limit', () => {
    expect(serverActionFileLimitBytes('20mb')).toBe(20 * 1024 * 1024 - SERVER_ACTION_ENVELOPE_BYTES);
    expect(serverActionFileLimitBytes('1mb')).toBe(1024 * 1024 - SERVER_ACTION_ENVELOPE_BYTES);
    expect(() => serverActionFileLimitBytes('nonsense')).toThrow(/SERVER_ACTIONS_BODY_LIMIT/);
    expect(() => serverActionFileLimitBytes('')).toThrow(/SERVER_ACTIONS_BODY_LIMIT/);
    // Every server action passes Next's proxy, which truncates bodies past proxyClientMaxBodySize (100mb).
    expect(serverActionFileLimitBytes('100mb')).toBe(NEXT_PROXY_MAX_BODY_BYTES - SERVER_ACTION_ENVELOPE_BYTES);
    expect(serverActionFileLimitBytes('200mb')).toBe(NEXT_PROXY_MAX_BODY_BYTES - SERVER_ACTION_ENVELOPE_BYTES);
    expect(serverActionFileLimitBytes('1gb')).toBe(NEXT_PROXY_MAX_BODY_BYTES - SERVER_ACTION_ENVELOPE_BYTES);
    expect(serverActionFileLimitBytes('10b')).toBe(0);
  });
});
