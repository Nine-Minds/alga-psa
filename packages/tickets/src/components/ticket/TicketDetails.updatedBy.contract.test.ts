import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, relative), 'utf8');

describe('MSP TicketDetails "Updated … by" header contract', () => {
  const details = read('./TicketDetails.tsx');

  it('renders the by-name variant only when an updater name resolves, else the plain label', () => {
    expect(details).toContain("t('fields.updatedAtBy'");
    expect(details).toContain("defaultValue: 'Updated {{time}} by {{name}}'");
    expect(details).toContain("t('fields.updated', 'Updated')");
    expect(details).toMatch(/updatedByName\s*\?/);
  });

  it('never labels a missing updater as System', () => {
    const header = details.slice(details.indexOf('data-testid="ticket-updated-at"') - 400, details.indexOf('data-testid="ticket-updated-at"') + 800);
    expect(header).not.toContain('systemAuthor');
  });

  it('seeds updatedByUser from the container and refreshes it after local saves', () => {
    expect(details).toContain('initialUpdatedByUser');
    expect(details).toContain('setUpdatedByUser(currentUser ?? null)');
    expect(read('./TicketDetailsContainer.tsx')).toContain('initialUpdatedByUser={ticketData.updatedByUser ?? null}');
  });

  it('no longer sends a client-side updated_at to the update actions', () => {
    expect(details).not.toMatch(/updateTicket\([^)]*updated_at/s);
    expect(read('./ticketDescriptionUpdate.ts')).not.toContain('updated_at');
    expect(read('../QuickAddTicket.tsx')).not.toMatch(/updateTicket\([^)]*updated_at/s);
  });
});
