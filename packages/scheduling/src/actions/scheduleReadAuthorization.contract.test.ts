import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// S11 (alga-2026-0003208): the schedule, dispatch and ticket lookups apply the viewer's read scope.
// These pin which functions each read goes through, so a new read path cannot skip the choke point unnoticed.
const read = (file: string) => readFileSync(resolve(__dirname, file), 'utf8');

const scheduleActions = read('./scheduleActions.ts');
const workItemActions = read('./workItemActions.ts');
const ticketLookupActions = read('./ticketLookupActions.ts');
const timeEntryWorkItemActions = read('./timeEntryWorkItemActions.ts');
const readMask = read('../lib/scheduleEntryReadMask.ts');
const ticketNarrowing = read('../lib/ticketReadNarrowing.ts');
const dispatchDashboard = read('../components/technician-dispatch/TechnicianDispatchDashboard.tsx');

function section(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  expect(start, `${startMarker} not found`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endMarker, start + startMarker.length);
  return source.slice(start, end === -1 ? undefined : end);
}

describe('schedule reads mask work items the viewer may not read', () => {
  it('getScheduleEntries resolves the read scope once and masks through the single choke point', () => {
    const body = section(scheduleActions, 'export const getScheduleEntries', 'export const addScheduleEntry');
    expect(body.match(/createScheduleEntryReadScope\(/g)).toHaveLength(2); // native read and delegated read, one per request
    expect(body).toContain('maskEntriesOutsideReadScope(trx, readScope');
  });

  it('getScheduleEntryById masks through the same choke point', () => {
    const body = section(scheduleActions, 'export const getScheduleEntryById', 'function sanitizeScheduleEntryForEvent');
    expect(body.match(/createScheduleEntryReadScope\(/g)).toHaveLength(2); // native read and delegated read, one per request
    expect(body).toContain('maskEntriesOutsideReadScope(trx, readScope');
  });

  it('the choke point reuses the busy representation and the authorization package decision', () => {
    expect(readMask).toContain("from './calendarAccess'");
    expect(readMask).toContain('maskEntry(entry, access)');
    expect(readMask).toContain('unreadableScheduleEntryIds(');
    expect(readMask).toContain('if (!scope.restricted) return entries;');
  });
});

describe('ticket lookups and work item search apply ticket read narrowing', () => {
  it('narrows in SQL after checking ticket:read', () => {
    expect(ticketNarrowing).toContain("hasPermission(user, 'ticket', 'read', db)");
    expect(ticketNarrowing).toContain('narrowTicketQueryToReadable(');
  });

  it('every ticket branch of the dispatch and picker searches and getWorkItemById narrows', () => {
    expect(workItemActions.match(/narrowTicketsToReadable\(db, tenant, user, /g)).toHaveLength(3);
  });

  it('getSchedulingTicketById narrows; the time sheet ticket list is left to S10 so entries and rows stay paired', () => {
    expect(ticketLookupActions).toContain('narrowTicketsToReadable(trx, tenant, user, query)');
    expect(timeEntryWorkItemActions).not.toContain('narrowTicketsToReadable');
  });

  it('an entry opened by id as an ad-hoc work item is checked against the read scope before it is read', () => {
    const byId = section(workItemActions, 'export const getWorkItemById', 'export const ');
    const adHoc = section(byId, "workItemType === 'ad_hoc'", "workItemType === 'interaction'");
    expect(adHoc.indexOf('canReadScheduleEntry(')).toBeGreaterThanOrEqual(0);
    expect(adHoc.indexOf('canReadScheduleEntry(')).toBeLessThan(adHoc.indexOf("table('schedule_entries as se')"));
    expect(readMask).toContain('export async function canReadScheduleEntry(');
  });

  it('dispatch opens busy time view-only instead of looking up its work item', () => {
    const click = section(dispatchDashboard, 'const handleEventClick', 'getWorkItemById(workItemId');
    expect(click).toContain("event.access === 'busy'");
  });

  it('the delegated (co-managed) schedule reads are masked through the same choke point', () => {
    const list = section(scheduleActions, 'export const getScheduleEntries', 'export const addScheduleEntry');
    const byId = section(scheduleActions, 'export const getScheduleEntryById', 'function sanitizeScheduleEntryForEvent');
    for (const body of [list, byId]) {
      const delegated = section(body, 'if (current.handled)', 'const canRead');
      expect(delegated).toContain('maskEntriesOutsideReadScope(');
      expect(delegated).toContain('delegatedViewAccess(user.user_id)');
    }
  });
});
