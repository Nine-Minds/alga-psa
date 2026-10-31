import { expect, it } from 'vitest';
import { coManagedAttachmentUploadLimit } from '../../../lib/co-managed/attachmentUploadLimit';
it('caps files below both the configured action envelope and the attachment limit', () => {
  expect(coManagedAttachmentUploadLimit('20mb')).toBe(20 * 1048576 - 65536);
  expect(coManagedAttachmentUploadLimit('30 MB')).toBe(25 * 1048576);
  expect(coManagedAttachmentUploadLimit('1.5mb')).toBe(1.5 * 1048576 - 65536);
  expect(coManagedAttachmentUploadLimit('1048576')).toBe(1048576 - 65536);
  for (const invalid of ['1kb', 'invalid', '-20mb', 'Infinity', '']) expect(coManagedAttachmentUploadLimit(invalid)).toBe(0);
});
