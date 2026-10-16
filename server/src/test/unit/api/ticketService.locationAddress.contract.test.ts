import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ticketWithDetailsResponseSchema } from '../../../lib/api/schemas/ticket';

describe('ticket location address for map links', () => {
  it('getTicketById returns the location postal address alongside its name', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../../lib/api/services/TicketService.ts'),
      'utf8'
    );
    expect(source).toContain("'cl.location_name as location_name'");
    expect(source).toContain("knex.raw(`${locationAddressSql('cl')} as location_address`)");
  });

  it('accepts location_address as a nullable string on the ticket response', () => {
    const field = ticketWithDetailsResponseSchema.shape.location_address;
    expect(field.safeParse('1 Main St, Springfield').success).toBe(true);
    expect(field.safeParse(null).success).toBe(true);
    expect(field.safeParse(undefined).success).toBe(true);
    expect(field.safeParse(42).success).toBe(false);
  });
});
