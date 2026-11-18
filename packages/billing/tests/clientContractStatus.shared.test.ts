import { describe, expect, it } from 'vitest';
import {
  deriveClientContractStatus,
  isLiveClientContractStatus,
  toLocalDateInTimeZone,
} from '../../../shared/billingClients/clientContractStatus';

describe('deriveClientContractStatus', () => {
  it('T023: derives active, expired, scheduled, and terminated states from assignment lifecycle fields', () => {
    expect(
      deriveClientContractStatus({
        isActive: true,
        startDate: '2026-03-01',
        endDate: null,
        now: '2026-03-16',
      })
    ).toBe('active');

    expect(
      deriveClientContractStatus({
        isActive: true,
        startDate: '2026-01-01',
        endDate: '2026-03-15',
        now: '2026-03-16',
      })
    ).toBe('expired');

    expect(
      deriveClientContractStatus({
        isActive: true,
        startDate: '2026-04-01',
        endDate: null,
        now: '2026-03-16',
      })
    ).toBe('scheduled');

    // Inactive assignments keep their terminated meaning even with a future start.
    expect(
      deriveClientContractStatus({
        isActive: false,
        startDate: '2026-04-01',
        endDate: null,
        now: '2026-03-16',
      })
    ).toBe('terminated');

    expect(
      deriveClientContractStatus({
        isActive: false,
        startDate: '2026-03-01',
        endDate: null,
        now: '2026-03-16',
      })
    ).toBe('terminated');
  });

  it('normalizes knex Date values for assignment start, end, and current dates', () => {
    expect(
      deriveClientContractStatus({
        isActive: true,
        startDate: new Date('2026-04-01T00:00:00.000Z'),
        endDate: null,
        now: new Date('2026-03-16T12:00:00.000Z'),
      })
    ).toBe('scheduled');

    expect(
      deriveClientContractStatus({
        isActive: true,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2026-03-15T00:00:00.000Z'),
        now: new Date('2026-03-16T12:00:00.000Z'),
      })
    ).toBe('expired');
  });

  it('always presents assignments belonging to draft contract headers as draft', () => {
    expect(
      deriveClientContractStatus({
        isActive: false,
        startDate: '2026-01-01',
        endDate: '2026-02-01',
        contractStatus: 'draft',
        now: '2026-03-16',
      })
    ).toBe('draft');
  });

  it('leaves lifecycle derivation unchanged for non-draft contract headers', () => {
    expect(
      deriveClientContractStatus({
        isActive: false,
        startDate: '2026-01-01',
        endDate: null,
        contractStatus: 'active',
        now: '2026-03-16',
      })
    ).toBe('terminated');
  });

  it('customer case: confirmed contract, active assignment, starts 2026-10-15, today 2026-10-14 is scheduled', () => {
    expect(
      deriveClientContractStatus({
        contractStatus: 'active',
        isActive: true,
        startDate: '2026-10-15',
        endDate: null,
        now: '2026-10-14',
      })
    ).toBe('scheduled');
  });

  it('becomes active on the start date and expired after the end date', () => {
    const base = { contractStatus: 'active', isActive: true, startDate: '2026-10-15', endDate: '2026-12-31' };
    expect(deriveClientContractStatus({ ...base, now: '2026-10-15' })).toBe('active');
    expect(deriveClientContractStatus({ ...base, now: '2026-12-31' })).toBe('active');
    expect(deriveClientContractStatus({ ...base, now: '2027-01-01' })).toBe('expired');
  });

  it('draft contract headers stay draft even with a future start', () => {
    expect(
      deriveClientContractStatus({
        contractStatus: 'draft',
        isActive: true,
        startDate: '2026-10-15',
        endDate: null,
        now: '2026-10-14',
      })
    ).toBe('draft');
  });

  it('uses the tenant-local date (not UTC) on both sides of a US midnight boundary', () => {
    const params = { contractStatus: 'active', isActive: true, startDate: '2026-10-15', endDate: null };
    // 2026-10-15T03:00Z is still Oct 14 22:00 in New York (EDT, UTC-4): scheduled.
    expect(
      deriveClientContractStatus({ ...params, now: new Date('2026-10-15T03:00:00Z'), timeZone: 'America/New_York' })
    ).toBe('scheduled');
    // 2026-10-15T04:00Z is Oct 15 00:00 in New York: active.
    expect(
      deriveClientContractStatus({ ...params, now: new Date('2026-10-15T04:00:00Z'), timeZone: 'America/New_York' })
    ).toBe('active');
    // Without a timezone the UTC date is used (documented fallback).
    expect(deriveClientContractStatus({ ...params, now: new Date('2026-10-15T03:00:00Z') })).toBe('active');
    // Los Angeles (UTC-7 in October) flips at 07:00Z.
    expect(
      deriveClientContractStatus({ ...params, now: new Date('2026-10-15T06:59:00Z'), timeZone: 'America/Los_Angeles' })
    ).toBe('scheduled');
    expect(
      deriveClientContractStatus({ ...params, now: new Date('2026-10-15T07:00:00Z'), timeZone: 'America/Los_Angeles' })
    ).toBe('active');
  });

  it('keeps date-only strings unshifted and falls back to UTC for invalid timezones', () => {
    expect(
      deriveClientContractStatus({
        isActive: true,
        startDate: '2026-10-15',
        endDate: null,
        now: '2026-10-15',
        timeZone: 'Pacific/Kiritimati',
      })
    ).toBe('active');
    expect(toLocalDateInTimeZone(new Date('2026-10-15T03:00:00Z'), 'Not/AZone')).toBe('2026-10-15');
  });

  it('treats scheduled as live (confirmed) but not draft', () => {
    expect(isLiveClientContractStatus('scheduled')).toBe(true);
    expect(isLiveClientContractStatus('draft')).toBe(false);
  });

  it('keeps the calendar date of a pg DATE Date (local midnight) instead of shifting via UTC', () => {
    // node-postgres returns DATE columns as local-midnight Date objects.
    expect(
      deriveClientContractStatus({
        isActive: true,
        startDate: new Date(2026, 9, 20),
        endDate: null,
        now: '2026-10-20',
      })
    ).toBe('active');
    expect(
      deriveClientContractStatus({
        isActive: true,
        startDate: new Date(2026, 9, 20),
        endDate: null,
        now: '2026-10-19',
      })
    ).toBe('scheduled');
    expect(
      deriveClientContractStatus({
        isActive: true,
        startDate: new Date(2026, 0, 1),
        endDate: new Date(2026, 9, 19),
        now: '2026-10-20',
      })
    ).toBe('expired');
  });
});
