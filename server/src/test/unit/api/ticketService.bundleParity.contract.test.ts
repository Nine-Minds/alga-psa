import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUNDLE_CHILD_LOCKED_FIELDS } from '../../../../../packages/tickets/src/lib/bundleWorkflowLock';

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
 * the in-app update action does: children of a sync_updates master cannot change workflow fields, and
 * a sync_updates master pushes its workflow changes down to the children.
 */
describe('TicketService bundle parity with the web update action', () => {
  const service = readSource('../../../lib/api/services/TicketService.ts');
  const webAction = readSource('../../../../../packages/tickets/src/actions/optimizedTicketActions.ts');

  it('locks the same child workflow fields the web action locks, through the shared rule', () => {
    const update = methodBody(service, 'async update(id: string, data: UpdateTicketData', 'private withDescriptionHtml');
    const sharedRule = readSource('../../../../../packages/tickets/src/lib/bundleWorkflowLock.ts');

    // The field list lives only in the shared module.
    expect(sharedRule).toContain("export const BUNDLE_CHILD_LOCKED_FIELDS = ['status_id', 'assigned_to', 'priority_id'] as const;");
    expect(BUNDLE_CHILD_LOCKED_FIELDS).toEqual(['status_id', 'assigned_to', 'priority_id']);
    expect(service).not.toContain("const BUNDLE_CHILD_LOCKED_FIELDS =");
    expect(webAction).not.toContain("new Set(['status_id', 'assigned_to', 'priority_id'])");

    // Both surfaces gate on the shared predicate and the shared constant.
    for (const source of [service, webAction]) {
      expect(source).toContain('isChildWorkflowLocked(');
      expect(source).toContain('BUNDLE_CHILD_LOCKED_FIELDS');
    }
    expect(update).toContain('BUNDLE_CHILD_LOCKED_FIELDS.filter(');
    expect(update).toContain('workflow fields are locked');
  });

  it('cascades master updates to children through the shared propagation engine', () => {
    const update = methodBody(service, 'async update(id: string, data: UpdateTicketData', 'private withDescriptionHtml');
    // REST shares the single propagation engine with the web action. The older
    // inline propagateBundleMasterUpdate is gone: it mirrored every synced field
    // (including is_closed) to all children before the engine could derive the
    // affected set, which defeated the confirmation and the ledger.
    expect(update).toContain('await propagateBundleMasterStatus(');
    expect(update).not.toContain('.propagateBundleMasterUpdate(');

    const utils = readSource('../../../../../packages/tickets/src/actions/ticketBundleUtils.ts');
    expect(utils).toContain("if (settings?.mode !== 'sync_updates')");
    expect(utils).toContain('.where({ master_ticket_id: masterId })');
  });

  it('the shared propagation engine syncs the denormalized is_closed flag to children', () => {
    const utils = readSource('../../../../../packages/tickets/src/actions/ticketBundleUtils.ts');
    expect(utils).toContain("is_closed: crossesBoundary === 'close',");
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
