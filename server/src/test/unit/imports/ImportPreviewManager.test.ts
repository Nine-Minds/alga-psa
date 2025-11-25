import { describe, it, expect, vi } from 'vitest';
import { ImportPreviewManager } from '@/lib/imports/ImportPreviewManager';
import type { DuplicateCheckResult, ParsedRecord } from 'server/src/types/imports.types';
import { ImportValidationError } from '@/lib/imports/errors';

const tenantId = '00000000-0000-0000-0000-000000000000';

const makeRecord = (rowNumber: number, values: Record<string, unknown>): ParsedRecord => ({
  rowNumber,
  raw: values,
  normalized: values,
});

describe('ImportPreviewManager', () => {
  it('produces summary metrics and column examples', async () => {
    const manager = new ImportPreviewManager(tenantId);
    const records = [
      makeRecord(2, { name: 'Device-1', serial: 'SN-1' }),
      makeRecord(3, { name: 'Device-2', serial: 'SN-2' }),
      makeRecord(4, { name: '', serial: 'SN-3' }),
    ];

    const validator = async (record: ParsedRecord) => {
      if (!record.raw.name) {
        return [
          new ImportValidationError(
            record.rowNumber,
            'name',
            record.raw.name,
            'Name is required'
          ),
        ];
      }
      return [];
    };

    const duplicateDetector = {
      check: vi.fn().mockResolvedValue({ isDuplicate: false } as DuplicateCheckResult),
    };

    const result = await manager.generate({
      tenantId,
      importJobId: 'job-1',
      records,
      validator,
      duplicateDetector,
    });

    expect(result.summary.totalRows).toBe(3);
    expect(result.summary.errorRows).toBe(1);
    expect(result.preview.columnExamples?.name).toEqual(['Device-1', 'Device-2']);
    expect(result.errorSummary?.rowsWithErrors).toBe(1);
  });
});
