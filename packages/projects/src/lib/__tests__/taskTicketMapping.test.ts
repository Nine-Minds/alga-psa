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
});
