import { describe, it, expect } from 'vitest';
import { mapTicketToTaskFields, mapTaskToTicketPrefill } from '../taskTicketMapping';

describe('mapTicketToTaskFields', () => {
  it('maps title to task_name', () => {
    const result = mapTicketToTaskFields({ title: 'Server Upgrade' });
    expect(result.task_name).toBe('Server Upgrade');
  });

  it('maps description from ticket data', () => {
    const result = mapTicketToTaskFields({ description: 'Detailed ticket description.' });
    expect(result.description).toBe('Detailed ticket description.');
  });

  it('maps assigned_to directly', () => {
    const result = mapTicketToTaskFields({ assigned_to: 'user-123' });
    expect(result.assigned_to).toBe('user-123');
  });

  it('converts due_date ISO string to Date', () => {
    const result = mapTicketToTaskFields({ due_date: '2026-02-05T12:30:00.000Z' });
    expect(result.due_date).toBeInstanceOf(Date);
    expect(result.due_date?.toISOString()).toBe('2026-02-05T12:30:00.000Z');
  });

  it('keeps estimated_hours in hours', () => {
    const result = mapTicketToTaskFields({ estimated_hours: 4.5 });
    expect(result.estimated_hours).toBe(4.5);
  });

  it('provides safe defaults for null/undefined fields', () => {
    const result = mapTicketToTaskFields(null);
    expect(result.task_name).toBe('');
    expect(result.description).toBe('');
    expect(result.assigned_to).toBeNull();
    expect(result.due_date).toBeNull();
    expect(result.estimated_hours).toBe(0);
  });
});

describe('mapTaskToTicketPrefill', () => {
  it('maps task_name to title', () => {
    const result = mapTaskToTicketPrefill(
      { task_name: 'Network upgrade', estimated_hours: 0 },
      { client_id: 'client-1', client_name: 'Acme' }
    );
    expect(result.title).toBe('Network upgrade');
  });

  it('converts estimated_hours from minutes to hours', () => {
    const result = mapTaskToTicketPrefill(
      { task_name: 'Network upgrade', estimated_hours: 150 },
      { client_id: 'client-1', client_name: 'Acme' }
    );
    expect(result.estimated_hours).toBe(2.5);
  });
});
