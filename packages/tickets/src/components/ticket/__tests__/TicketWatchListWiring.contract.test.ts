import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('ticket watch-list picker wiring contract', () => {
  it('T057: TicketDetails/TicketProperties pass client contacts, all-contact fallback hooks, and internal users into TicketWatchListCard', () => {
    const ticketDetailsSource = read('../TicketDetails.tsx');
    const ticketPropertiesSource = read('../TicketProperties.tsx');

    expect(ticketDetailsSource).toContain('allContactsForWatchList={allContactsForWatchList}');
    expect(ticketDetailsSource).toContain(
      'allContactsForWatchListLoading={allContactsForWatchListLoading}'
    );
    expect(ticketDetailsSource).toContain(
      'onLoadAllContactsForWatchList={handleLoadAllContactsForWatchList}'
    );

    expect(ticketPropertiesSource).toContain('internalUsers={availableAgents}');
    expect(ticketPropertiesSource).toContain('clientContacts={contacts}');
    expect(ticketPropertiesSource).toContain('allContacts={allContactsForWatchList}');
    expect(ticketPropertiesSource).toContain('allContactsLoading={allContactsForWatchListLoading}');
    expect(ticketPropertiesSource).toContain('onLoadAllContacts={onLoadAllContactsForWatchList}');
  });
});
