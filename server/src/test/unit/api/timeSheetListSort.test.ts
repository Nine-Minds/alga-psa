import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import { resolveTimeSheetListSort } from '../../../lib/api/services/TimeSheetService';
import { timeSheetListQuerySchema } from '../../../lib/api/schemas/timeSheet';
import { ValidationError } from '../../../lib/api/middleware/apiMiddleware';

describe('resolveTimeSheetListSort', () => {
  it('defaults to period_start', () => {
    const r = resolveTimeSheetListSort(undefined);
    expect(r.field).toBe('period_start');
    expect(r.spec.column).toBe('time_periods.start_date');
  });

  it('treats created_at as an alias of period_start', () => {
    expect(resolveTimeSheetListSort('created_at').field).toBe('period_start');
  });

  it.each([
    ['period_start', 'time_periods.start_date', undefined],
    ['period_end', 'time_periods.end_date', undefined],
    ['submitted_at', 'time_sheets.submitted_at', true],
    ['approved_at', 'time_sheets.approved_at', true],
    ['approval_status', 'time_sheets.approval_status', undefined],
  ])('maps %s to %s', (key, column, nullable) => {
    const r = resolveTimeSheetListSort(key);
    expect(r.spec.column).toBe(column);
    expect(r.spec.nullable).toBe(nullable);
  });

  it.each(['bogus', 'created_at; drop table x', 'user_id', 'id'])('rejects %s with a 400 ValidationError', (key) => {
    try {
      resolveTimeSheetListSort(key);
      throw new Error('expected throw');
    } catch (e: any) {
      expect(e).toBeInstanceOf(ValidationError);
      expect(e.statusCode).toBe(400);
    }
  });
});

describe('timeSheetListQuerySchema sort', () => {
  it('defaults sort to period_start', () => {
    expect(timeSheetListQuerySchema.parse({}).sort).toBe('period_start');
  });
  it('accepts allowlisted keys and the created_at alias', () => {
    expect(timeSheetListQuerySchema.parse({ sort: 'approved_at' }).sort).toBe('approved_at');
    expect(timeSheetListQuerySchema.parse({ sort: 'created_at' }).sort).toBe('created_at');
  });
  it('rejects unknown sort values', () => {
    expect(() => timeSheetListQuerySchema.parse({ sort: 'bogus' })).toThrow(ZodError);
  });
});
