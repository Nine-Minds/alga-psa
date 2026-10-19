import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { updateTicketSchema } from '../../lib/api/schemas/ticket';

/**
 * Board close rules can require category_id/subcategory_id before a ticket may
 * close. The mobile app could not read the categories (the CRUD surface is
 * ticket_settings:read) nor clear a stale subcategory, so a gated board made
 * tickets unresolvable from the phone. This pins the read route, the nullable
 * update fields and the generated specs that ship them.
 */
const REPO_ROOT = path.resolve(__dirname, '../../../..');

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, relativePath), 'utf8');
}

function spec(edition: 'ce' | 'ee'): any {
  return JSON.parse(source(`sdk/docs/openapi/alga-openapi.${edition}.json`));
}

describe('ticket category REST surface', () => {
  it('lists categories behind ticket:read, board-filtered, like the statuses sibling', () => {
    const text = source('server/src/app/api/v1/tickets/categories/route.ts');

    expect(text).toMatch(/export const GET/);
    expect(text).toContain("hasPermission(user, 'ticket', 'read')");
    expect(text).toContain("board_id: z.string().uuid().optional()");
    expect(text).toContain("table('categories')");
    expect(text).toContain("'parent_category'");
  });

  it('accepts a category pair and clears either side with null', () => {
    const base = { category_id: '11111111-1111-4111-8111-111111111111' };

    expect(updateTicketSchema.parse(base).category_id).toBe(base.category_id);
    expect(updateTicketSchema.parse({ ...base, subcategory_id: null }).subcategory_id).toBeNull();
    expect(updateTicketSchema.parse({ category_id: null }).category_id).toBeNull();
    expect(() => updateTicketSchema.parse({ category_id: 'not-a-uuid' })).toThrow();
  });

  it('returns the subcategory name with the ticket detail the mobile app renders', () => {
    const text = source('server/src/lib/api/services/TicketService.ts');

    expect(text).toContain("'categories as subcat', 't.subcategory_id', 'subcat.category_id'");
    expect(text).toContain("'subcat.category_name as subcategory_name'");
  });

  it.each(['ce', 'ee'] as const)('documents the %s read route and the nullable update fields', (edition) => {
    const document = spec(edition);

    const categories = document.paths['/api/v1/tickets/categories'];
    expect(categories?.get).toBeDefined();
    expect(categories.get.extensions['x-rbac-action']).toBe('read');
    expect(categories.get.parameters[0].name).toBe('board_id');

    const updateBody = document.components.schemas.WorkV1TicketUpdateBody.properties;
    expect(updateBody.category_id.type).toEqual(['string', 'null']);
    expect(updateBody.subcategory_id.type).toEqual(['string', 'null']);
  });
});
