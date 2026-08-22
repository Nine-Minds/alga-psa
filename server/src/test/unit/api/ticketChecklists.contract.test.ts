import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createTicketChecklistItemSchema,
  updateTicketChecklistCompletionSchema,
} from '../../../lib/api/schemas/ticket';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('Ticket checklist REST API contract', () => {
  it('validates and normalizes the mobile checklist write subset', () => {
    expect(createTicketChecklistItemSchema.parse({
      item_name: '  Verify backups  ',
      description: null,
    })).toEqual({
      item_name: 'Verify backups',
      description: null,
    });
    expect(createTicketChecklistItemSchema.safeParse({ item_name: '   ' }).success).toBe(false);
    expect(createTicketChecklistItemSchema.safeParse({ item_name: 'x', assigned_to: 'not-exposed' }).success).toBe(false);

    expect(updateTicketChecklistCompletionSchema.parse({ completed: true })).toEqual({ completed: true });
    expect(updateTicketChecklistCompletionSchema.safeParse({ completed: 'true' }).success).toBe(false);
    expect(updateTicketChecklistCompletionSchema.safeParse({ completed: true, item_name: 'not-editable' }).success).toBe(false);
  });

  it('delegates route handlers to the checklist controller methods', () => {
    const collectionRoute = readSource('../../../app/api/v1/tickets/[id]/checklist/route.ts');
    const itemRoute = readSource('../../../app/api/v1/tickets/[id]/checklist/[itemId]/route.ts');

    expect(collectionRoute).toContain('export const GET = controller.getChecklist();');
    expect(collectionRoute).toContain('export const POST = controller.createChecklistItem();');
    expect(itemRoute).toContain('export const PATCH = controller.updateChecklistItemCompletion();');
  });

  it('uses shared authentication, ticket authorization, and canonical checklist actions', () => {
    const source = readSource('../../../lib/api/controllers/ApiTicketController.ts');

    expect(source).toContain('getChecklist()');
    expect(source).toContain('createChecklistItem()');
    expect(source).toContain('updateChecklistItemCompletion()');
    expect(source).toContain('return await this.runWithApiKeyContext(apiRequest, async () => {');
    expect(source).toContain("await this.checkPermission(apiRequest, this.options.permissions?.read || 'read');");
    expect(source).toContain("await this.checkPermission(apiRequest, this.options.permissions?.update || 'update');");
    expect(source).toContain('await this.assertTicketReadAllowed(apiRequest, ticketId, knex);');
    expect(source).toContain('const checklist = await getTicketChecklistItems(ticketId);');
    expect(source).toContain('const result = await addChecklistItem(ticketId, data);');
    expect(source).toContain('const result = await setChecklistItemCompleted(itemId, data.completed);');
  });

  it('binds a checklist item to the authorized ticket before mutating it', () => {
    const source = readSource('../../../lib/api/controllers/ApiTicketController.ts');
    const bindingCheck = source.indexOf('if (!before.some((item) => item.checklist_item_id === itemId))');
    const mutation = source.indexOf('const result = await setChecklistItemCompleted(');

    expect(bindingCheck).toBeGreaterThan(-1);
    expect(mutation).toBeGreaterThan(bindingCheck);
    expect(source).toContain("throw new NotFoundError('Checklist item not found');");
  });

  it('publishes all three authenticated endpoints in OpenAPI', () => {
    const source = readSource('../../../lib/api/openapi/routes/workManagementV1.ts');

    expect(source).toContain("method: 'get', path: '/api/v1/tickets/{id}/checklist'");
    expect(source).toContain("method: 'post', path: '/api/v1/tickets/{id}/checklist'");
    expect(source).toContain("method: 'patch', path: '/api/v1/tickets/{id}/checklist/{itemId}'");
    expect(source).toContain('request: { params: IdParam, body: { schema: TicketChecklistCreateBody } }');
    expect(source).toContain('request: { params: TicketChecklistItemParams, body: { schema: TicketChecklistCompletionBody } }');
    expect(source).toContain("extensions: ticketExt('update'), edition: 'both'");
    expect(source).toContain('tags: [tag], security: [{ ApiKeyAuth: [] }]');
  });
});
