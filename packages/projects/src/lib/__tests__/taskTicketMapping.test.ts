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

  it('provides safe defaults for null/undefined fields', () => {
    const result = mapTicketToTaskFields(null);
    expect(result.task_name).toBe('');
    expect(result.description).toBe('');
    expect(result.assigned_to).toBeNull();
    expect(result.due_date).toBeNull();
    expect(result.estimated_hours).toBe(0);
  });

  it('does not include priority_id', () => {
    const result = mapTicketToTaskFields({ title: 'A', priority_id: 'priority-1' } as any);
    expect('priority_id' in result).toBe(false);
  });
});

describe('mapTaskToTicketPrefill', () => {
  it('maps task_name to title', () => {
    const result = mapTaskToTicketPrefill(
      { task_name: 'Network upgrade' },
      { client_id: 'client-1', client_name: 'Acme' }
    );
    expect(result.title).toBe('Network upgrade');
  });

  it('includes project client_id and client_name', () => {
    const result = mapTaskToTicketPrefill(
      { task_name: 'Network upgrade' },
      { client_id: 'client-55', client_name: 'Globex' }
    );
    expect(result.client_id).toBe('client-55');
    expect(result.client_name).toBe('Globex');
  });

  it('does not include priority_id', () => {
    const result = mapTaskToTicketPrefill(
      { task_name: 'Network upgrade', priority_id: 'priority-2' },
      { client_id: 'client-55', client_name: 'Globex' }
    );
    expect('priority_id' in result).toBe(false);
  });
});
