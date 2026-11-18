import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ticketCreatorName } from './ticketCreatorName';

describe('ticketCreatorName', () => {
  it('names a native ticket by its creator user, as before', () => {
    expect(ticketCreatorName({ first_name: 'Ada', last_name: 'Lovelace' }, {})).toBe('Ada Lovelace');
    expect(ticketCreatorName({ first_name: 'Ada', last_name: null }, {})).toBe('Ada');
  });
  it('uses the attributed display name for a shared ticket', () => {
    expect(ticketCreatorName(null, { created_by_display_name: ' Customer Admin ' })).toBe('Customer Admin');
    expect(ticketCreatorName(undefined, { created_by_display_name: 'Customer Admin' })).toBe('Customer Admin');
  });
  it('is null (rendered as N/A) when nobody is named, never "null null"', () => {
    expect(ticketCreatorName(null, {})).toBeNull();
    expect(ticketCreatorName(null, { created_by_display_name: '  ' })).toBeNull();
    expect(ticketCreatorName({ first_name: null, last_name: null }, {})).toBeNull();
  });
});

describe('read-only shared ticket UI wiring', () => {
  const read = (file: string) => readFileSync(path.resolve(__dirname, file), 'utf8');
  it('disables the All-fields drawer contact and location selects when the data source is read-only', () => {
    const source = read('TicketDetails.tsx');
    for (const field of ['contact', 'location']) {
      const start = source.indexOf(`all-fields-${field}-select\`}\n`);
      expect(start).toBeGreaterThan(-1);
      const block = source.slice(start, source.indexOf('/>', start));
      expect(block).toContain('disabled={dataSource.screen.readOnly === true}');
    }
  });
  it('shows the shared creator helper in the Entry layout and the Grid hero', () => {
    expect(read('TicketProperties.tsx')).toContain('ticketCreatorName(createdByUser, ticket)');
    expect(read('bento/BentoHero.tsx')).toContain('ticketCreatorName(createdByUser, ticket)');
  });
});
