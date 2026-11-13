import { expect, it } from 'vitest';
import { serverActionFileLimitBytes } from '@alga-psa/storage/ingest/bufferedCap';
import { coManagedAttachmentUploadLimit } from '../../../lib/co-managed/attachmentUploadLimit';

it('caps files below both the configured action envelope and the attachment limit', () => {
  expect(coManagedAttachmentUploadLimit('20mb')).toBe(20 * 1048576 - 65536);
  expect(coManagedAttachmentUploadLimit('30 MB')).toBe(25 * 1048576);
  expect(coManagedAttachmentUploadLimit('1.5mb')).toBe(1.5 * 1048576 - 65536);
  expect(coManagedAttachmentUploadLimit('1048576')).toBe(1048576 - 65536);
  expect(coManagedAttachmentUploadLimit('1kb')).toBe(0);
});

it('is the shared server-action limit, so the two parsers cannot disagree', () => {
  for (const limit of ['20mb', '1.5mb', '1048576', '1kb']) {
    expect(coManagedAttachmentUploadLimit(limit)).toBe(serverActionFileLimitBytes(limit));
  }
  // Only the co-managed limit is clamped to 25 MiB; the shared limit follows the body limit.
  expect(coManagedAttachmentUploadLimit('200mb')).toBe(25 * 1048576);
  // The shared server-action limit itself stops at the 100 MB proxy limit (less the envelope).
  expect(serverActionFileLimitBytes('200mb')).toBe(100 * 1048576 - 65536);
});

it('throws on an unparseable body limit instead of assuming a default', () => {
  for (const invalid of ['invalid', '-20mb', 'Infinity', '']) {
    expect(() => coManagedAttachmentUploadLimit(invalid)).toThrow(/SERVER_ACTIONS_BODY_LIMIT/);
  }
});
