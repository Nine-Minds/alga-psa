import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/logger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import logger from '@alga-psa/core/logger';
import { optionalEmailData } from '../../../lib/notifications/optionalEmailData';

describe('optionalEmailData', () => {
  it('returns what the builder produced', async () => {
    expect(await optionalEmailData('a detail block', [], async () => ['row'])).toEqual(['row']);
    expect(await optionalEmailData('a name', 'System', () => 'Morgan')).toBe('Morgan');
  });

  it('logs a failure and returns the fallback, so the email is still sent', async () => {
    const result = await optionalEmailData('the time entries', [] as string[], async () => {
      throw new Error('relation "time_entries" is locked');
    }, { ticketId: 't1' });

    expect(result).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('the time entries'),
      expect.objectContaining({ ticketId: 't1', error: 'relation "time_entries" is locked' }),
    );
  });

  it('survives a builder that throws synchronously or throws a non-Error', async () => {
    expect(await optionalEmailData('sync', 'fallback', () => { throw 'boom'; })).toBe('fallback');
  });
});
