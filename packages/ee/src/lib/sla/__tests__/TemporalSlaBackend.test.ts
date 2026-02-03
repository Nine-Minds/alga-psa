import { describe, it, expect } from 'vitest';
import { TemporalSlaBackend } from '../TemporalSlaBackend';

describe('TemporalSlaBackend (CE stub)', () => {
  it('throws only available in Enterprise Edition', async () => {
    const backend = new TemporalSlaBackend();
    await expect(
      backend.startSlaTracking(
        'ticket-1',
        'policy-1',
        [],
        {
          schedule_id: '24x7',
          schedule_name: '24x7',
          timezone: 'UTC',
          is_default: false,
          is_24x7: true,
          entries: [],
          holidays: [],
        }
      )
    ).rejects.toThrow('Enterprise Edition');
  });
});
