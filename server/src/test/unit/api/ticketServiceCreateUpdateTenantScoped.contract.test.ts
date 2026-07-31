import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../../lib/api/services/TicketService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('ticket service create and update tenant-scoped query contract', () => {
  it('uses structural tenant scoping for create/update/create-from-asset roots', () => {
    const createSection = sectionBetween('private async createTicket', '  /**\n   * Update ticket');
    const updateSection = sectionBetween('async update(', '  private withDescriptionHtml');
    const createFromAssetSection = sectionBetween('async createFromAsset', '  /**\n   * Get ticket comments');

    expect(createSection).toContain("tenantScopedTable(trx, 'tickets', context.tenant)");
    expect(createSection).not.toContain('.where({ ticket_id: ticketResult.ticket_id, tenant: context.tenant })');

    expect(updateSection).toContain("tenantScopedTable(trx, 'tickets', context.tenant)");
    expect(updateSection).toContain("tenantScopedTable(trx, 'statuses', context.tenant)");
    expect(updateSection).not.toContain('.where({ ticket_id: id, tenant: context.tenant })');
    expect(updateSection).not.toContain('.where({ status_id: cleanedData.status_id, tenant: context.tenant })');
    expect(updateSection).not.toContain('.where({ status_id: currentTicket.status_id, tenant: context.tenant })');
    expect(updateSection).not.toContain('.where({ status_id: data.status_id, tenant: context.tenant })');

    expect(createFromAssetSection).toContain("tenantScopedTable(trx, 'assets', context.tenant)");
    expect(createFromAssetSection).toContain("tenantScopedTable(trx, 'tickets', context.tenant)");
    expect(createFromAssetSection).not.toContain('.where({ asset_id: data.asset_id, tenant: context.tenant })');
    expect(createFromAssetSection).not.toContain('.where({ ticket_id: ticketResult.ticket_id, tenant: context.tenant })');
  });
});
