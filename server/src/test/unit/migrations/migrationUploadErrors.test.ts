import { describe, expect, it } from 'vitest';
import {
  migrationUploadErrorCopy,
  MIGRATION_UPLOAD_CODES,
} from '@/components/settings/migrations/migrationUi';

describe('migration upload error copy', () => {
  it('provides mapped copy for every code in the closed set', () => {
    for (const code of MIGRATION_UPLOAD_CODES) {
      const copy = migrationUploadErrorCopy(code);
      expect(copy.key).toMatch(/^importExport\.migration\.errors\./);
      expect(copy.defaultValue.length).toBeGreaterThan(0);
    }
  });

  it('separates a storage rejection from a bad file', () => {
    const storage = migrationUploadErrorCopy('AMP_STORAGE_REJECTED');
    const spreadsheet = migrationUploadErrorCopy('AMP_SPREADSHEET_FAILED');
    expect(storage.key).not.toBe(spreadsheet.key);
    expect(storage.defaultValue).not.toBe(spreadsheet.defaultValue);
  });

  it('falls back to generic copy for an unknown code and never echoes the raw string', () => {
    const copy = migrationUploadErrorCopy('File type not allowed');
    expect(copy.key).toBe('importExport.migration.errors.unknown');
    expect(copy.defaultValue).not.toContain('File type not allowed');
  });
});
