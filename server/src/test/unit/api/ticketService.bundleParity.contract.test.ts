import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relative: string): string {
  return fs.readFileSync(path.resolve(__dirname, relative), 'utf8');
}

function methodBody(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  const to = source.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

/**
 * The REST ticket surface (mobile app, public API) must treat bundles the way
 * the in-app update action does: children cannot change workflow fields, and
 * a sync_updates master pushes its workflow changes down to the children.
 */
describe('TicketService bundle parity with the web update action', () => {
  const service = readSource('../../../lib/api/services/TicketService.ts');
  const webAction = readSource('../../../../../packages/tickets/src/actions/optimizedTicketActions.ts');

  it('locks the same child workflow fields the web action locks', () => {
    const update = methodBody(service, 'async update(id: string, data: UpdateTicketData', 'private withDescriptionHtml');
    expect(service).toContain("const BUNDLE_CHILD_LOCKED_FIELDS = ['status_id', 'assigned_to', 'priority_id'] as const;");
    expect(update).toContain('if (currentTicket.master_ticket_id) {');
    expect(update).toContain('BUNDLE_CHILD_LOCKED_FIELDS.filter(');
    expect(update).toContain('workflow fields are locked');

    expect(webAction).toContain("const lockedFields = new Set(['status_id', 'assigned_to', 'priority_id']);");
  });

  it('cascades master updates to children only in sync_updates mode', () => {
    const update = methodBody(service, 'async update(id: string, data: UpdateTicketData', 'private withDescriptionHtml');
    expect(update).toContain('await this.propagateBundleMasterUpdate(trx, context, id, updateData);');

    const propagate = methodBody(service, 'private async propagateBundleMasterUpdate(', 'private withDescriptionHtml');
    expect(propagate).toContain("if (settings?.mode !== 'sync_updates') return;");
    expect(propagate).toContain('.where({ master_ticket_id: masterTicketId })');
    expect(service).toContain(
      "const BUNDLE_SYNCED_FIELDS = ['status_id', 'assigned_to', 'priority_id', 'is_closed', 'closed_by', 'closed_at'] as const;"
    );
  });

  it('the web cascade also syncs the denormalized is_closed flag to children', () => {
    const cascade = webAction.slice(webAction.indexOf("if (bundleSettings?.mode === 'sync_updates') {"));
    expect(cascade).toContain('propagateFields.is_closed = !!newStatus?.is_closed;');
  });

  it('exposes the bundled list view and bundle columns to REST clients', () => {
    const schema = readSource('../../../lib/api/schemas/ticket.ts');
    expect(schema).toContain("bundle_view: z.enum(['bundled', 'individual']).optional()");

    const filters = methodBody(service, 'private applyTicketFilters(', 'private ');
    expect(filters).toContain("case 'bundle_view':");
    expect(filters).toContain("query.whereNull('t.master_ticket_id');");

    const mobileFields = methodBody(service, 'const TICKET_MOBILE_LIST_FIELDS = [', '];');
    for (const field of ['master_ticket_id', 'bundle_master_ticket_number', 'bundle_child_count']) {
      expect(mobileFields).toContain(`'${field}'`);
    }

    const getById = methodBody(service, 'async getById(id: string', 'const [documents');
    expect(getById).toContain("'mt.ticket_number as bundle_master_ticket_number'");
    expect(getById).toContain('AS bundle_child_count');
  });
});
