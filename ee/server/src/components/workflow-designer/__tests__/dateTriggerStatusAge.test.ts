import { describe, expect, it } from 'vitest';
import { isStatusNameAvailable, parseDayCount, statusNameOptions } from '../dateTriggerStatusAge';

const statuses = [
  { id: 's1', name: 'Waiting for client', board_id: 'b1' },
  { id: 's2', name: 'waiting for client', board_id: 'b2' },
  { id: 's3', name: 'In progress', board_id: 'b1' },
  { id: 's4', name: 'Escalated', board_id: 'b2' },
];

describe('status-age trigger controls', () => {
  it('offers distinct status names (case-insensitive) across boards', () => {
    expect(statusNameOptions(statuses, null).map((o) => o.value)).toEqual(['Escalated', 'In progress', 'Waiting for client']);
  });

  it('narrows to the chosen board', () => {
    expect(statusNameOptions(statuses, 'b1').map((o) => o.value)).toEqual(['In progress', 'Waiting for client']);
    expect(statusNameOptions(statuses, 'b2').map((o) => o.value)).toEqual(['Escalated', 'waiting for client']);
  });

  it('reports a status name the chosen board does not have', () => {
    expect(isStatusNameAvailable(statuses, 'b2', 'Escalated')).toBe(true);
    expect(isStatusNameAvailable(statuses, 'b2', 'In progress')).toBe(false);
    expect(isStatusNameAvailable(statuses, null, 'waiting FOR client')).toBe(true);
  });

  it('clamps day counts to 1..365', () => {
    expect(parseDayCount('')).toBeNull();
    expect(parseDayCount('0')).toBe(1);
    expect(parseDayCount('400')).toBe(365);
    expect(parseDayCount('7.9')).toBe(7);
  });
});
