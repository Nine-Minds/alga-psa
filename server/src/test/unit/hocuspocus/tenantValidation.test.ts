import { describe, it, expect } from 'vitest';

import { validateDocumentRoomAccess } from '../../../../../hocuspocus/tenantValidation.js';

describe('validateDocumentRoomAccess', () => {
  it('rejects room names with mismatched tenant', () => {
    const request = { url: 'http://localhost?tenantId=tenant-a' };
    expect(() => validateDocumentRoomAccess('document:tenant-b:doc-1', request)).toThrow(
      'Tenant validation failed: room tenant mismatch'
    );
  });

  it('allows room names with matching tenant', () => {
    const request = { url: 'http://localhost?tenantId=tenant-a' };
    expect(validateDocumentRoomAccess('document:tenant-a:doc-1', request)).toEqual({
      status: 'ok',
      tenantId: 'tenant-a',
      documentId: 'doc-1',
    });
  });

  it('bypasses validation for notification rooms', () => {
    const request = { url: 'http://localhost?tenantId=tenant-a' };
    expect(validateDocumentRoomAccess('notifications:tenant-a', request)).toEqual({
      status: 'bypass',
      reason: 'notifications',
    });
  });
});
