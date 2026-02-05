import { describe, it, expect } from 'vitest';
import { mapTicketToTaskFields } from '../taskTicketMapping';

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
});
