import { describe, expect, it } from 'vitest';
import { buildClientAnniversaryUpcomingPayload } from '../clientDateEventBuilders';

describe('client anniversary event payload builder', () => {
  it('preserves the event contract fields', () => {
    expect(buildClientAnniversaryUpcomingPayload({
      clientId: 'client-1', clientName: 'Acme', anniversaryDate: '2026-10-01', yearsAsClient: 5, daysUntilAnniversary: 8,
    })).toEqual({
      clientId: 'client-1', clientName: 'Acme', anniversaryDate: '2026-10-01', yearsAsClient: 5, daysUntilAnniversary: 8,
    });
  });
});
