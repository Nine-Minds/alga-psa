import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createExternalLinkSchema,
  createTicketExternalLinkSchema,
  updateExternalLinkSchema,
  externalLinkLookupQuerySchema,
  createTicketSchema,
  createTicketCommentSchema,
  updateTicketSchema,
} from '../../../lib/api/schemas/ticket';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('Ticket external links REST API contract', () => {
  it('validates create/update payloads and rejects non-http urls and foreign fields', () => {
    expect(
      createTicketExternalLinkSchema.parse({
        system: 'github',
        external_id: '  42  ',
        url: 'https://github.com/acme/repo/issues/42',
      }),
    ).toMatchObject({
      system: 'github',
      external_id: '42',
      url: 'https://github.com/acme/repo/issues/42',
    });

    // entity_type / comment_id are ticket-endpoint concerns and are omitted from
    // the bound schema; strict() rejects them if a caller supplies them.
    expect(createTicketExternalLinkSchema.safeParse({ system: 'github', external_id: '1', entity_type: 'comment' }).success).toBe(false);
    expect(createTicketExternalLinkSchema.safeParse({ system: 'github', external_id: '1', url: 'javascript:alert(1)' }).success).toBe(false);
    expect(createTicketExternalLinkSchema.safeParse({ system: 'github', external_id: '' }).success).toBe(false);

    // The bound POST /external-links endpoint uses the full schema and accepts
    // comment-level references.
    expect(
      createExternalLinkSchema.parse({
        entity_type: 'comment',
        comment_id: '11111111-1111-4111-8111-111111111111',
        system: 'discord',
        external_id: '123',
      }),
    ).toMatchObject({ entity_type: 'comment' });
    expect(createExternalLinkSchema.safeParse({ entity_type: 'bogus', system: 'github', external_id: '1' }).success).toBe(false);

    expect(updateExternalLinkSchema.parse({ external_status: 'closed' })).toEqual({ external_status: 'closed' });
    expect(updateExternalLinkSchema.safeParse({ system: 'jira' }).success).toBe(false);
    expect(updateExternalLinkSchema.safeParse({ url: 'file:///etc/passwd' }).success).toBe(false);
  });

  it('validates visibility without defaulting an omitted update or permitting inline sharing', () => {
    const input = { system: 'generic', external_id: 'Vendor case', url: 'https://example.com/case' };
    expect(createExternalLinkSchema.parse(input).portal_visible).toBeUndefined();
    expect(createExternalLinkSchema.parse({ ...input, portal_visible: true }).portal_visible).toBe(true);
    expect(updateExternalLinkSchema.parse({})).not.toHaveProperty('portal_visible');
    expect(updateExternalLinkSchema.parse({ portal_visible: false })).toEqual({ portal_visible: false });
    for (const portal_visible of [null, 'true', 1]) {
      expect(createExternalLinkSchema.safeParse({ ...input, portal_visible }).success).toBe(false);
      expect(updateExternalLinkSchema.safeParse({ portal_visible }).success).toBe(false);
    }
    expect(createTicketExternalLinkSchema.safeParse({ ...input, portal_visible: true }).success).toBe(false);
  });

  it('requires system and external_id on the by-external-link lookup', () => {
    expect(externalLinkLookupQuerySchema.parse({ system: 'jira', external_id: 'OPS-1' })).toEqual({
      system: 'jira',
      external_id: 'OPS-1',
    });
    expect(externalLinkLookupQuerySchema.safeParse({ system: 'jira' }).success).toBe(false);
    expect(externalLinkLookupQuerySchema.safeParse({ external_id: 'x' }).success).toBe(false);
  });

  it('treats external_links as create-only (rejected/omitted from ticket updates)', () => {
    const parsed = updateTicketSchema.safeParse({
      title: 'x',
      external_links: [{ system: 'github', external_id: '1' }],
    });
    expect(parsed.success).toBe(true);
    expect((parsed.data as any)?.external_links).toBeUndefined();
    expect(createTicketSchema.shape.external_links).toBeDefined();
  });

  it('accepts inline external_links on ticket and comment create', () => {
    const link = { system: 'discord', external_id: '123' };
    expect(createTicketSchema.shape.external_links).toBeDefined();
    expect(createTicketSchema.partial().safeParse({ external_links: [link] }).success).toBe(true);
    expect(createTicketCommentSchema.safeParse({ comment_text: 'hello', external_links: [link] }).success).toBe(true);
    expect(createTicketCommentSchema.safeParse({ comment_text: 'hello', external_links: [{ system: 'discord', external_id: '' }] }).success).toBe(false);
  });

  it('delegates the five route handlers to the external-link controller methods', () => {
    const collectionRoute = readSource('../../../app/api/v1/tickets/[id]/external-links/route.ts');
    const itemRoute = readSource('../../../app/api/v1/tickets/[id]/external-links/[linkId]/route.ts');
    const lookupRoute = readSource('../../../app/api/v1/tickets/by-external-link/route.ts');

    expect(collectionRoute).toContain('export const GET = controller.getExternalLinks();');
    expect(collectionRoute).toContain('export const POST = controller.createExternalLink();');
    expect(itemRoute).toContain('export const PATCH = controller.updateExternalLink();');
    expect(itemRoute).toContain('export const DELETE = controller.deleteExternalLink();');
    expect(lookupRoute).toContain('export const GET = controller.findByExternalLink();');
  });

  it('uses shared auth, permission gating, and ticket authorization', () => {
    const source = readSource('../../../lib/api/controllers/ApiTicketController.ts');

    expect(source).toContain('getExternalLinks()');
    expect(source).toContain('createExternalLink()');
    expect(source).toContain('updateExternalLink()');
    expect(source).toContain('deleteExternalLink()');
    expect(source).toContain('findByExternalLink()');
    expect(source).toContain('return await this.runWithApiKeyContext(apiRequest, async () => {');
    expect(source).toContain('await this.assertTicketReadAllowed(apiRequest, ticketId, knex);');
    expect(source).toContain('const links = await getTicketExternalLinks(ticketId);');
    expect(source).toContain('const linkId = this.extractExternalLinkId(apiRequest);');
    expect(source).toContain('this.validateData(apiRequest, createExternalLinkSchema)');
    expect(source).toContain('await addExternalLink({ ticket_id: ticketId, ...data })');
  });

  it('authorizes the resolved ticket before returning by-external-link data', () => {
    const source = readSource('../../../lib/api/controllers/ApiTicketController.ts');
    const lookupStart = source.indexOf('findByExternalLink()');
    const authCall = source.indexOf(
      'await this.assertTicketReadAllowed(apiRequest, result.ticket_id, knex);',
    );
    const returnLine = source.indexOf(
      'return createSuccessResponse(result, 200, undefined, apiRequest);',
      lookupStart,
    );

    expect(lookupStart).toBeGreaterThan(-1);
    expect(authCall).toBeGreaterThan(lookupStart);
    expect(authCall).toBeLessThan(returnLine);
  });

  it('matches external_system and external_id against the same link row', () => {
    const source = readSource('../../../lib/api/services/TicketService.ts');

    expect(source).toContain('handledExternalFilters');
    expect(source).toContain("externalLinkSubquery.andWhere('eel.system', externalSystem)");
    expect(source).toContain("externalLinkSubquery.andWhere('eel.external_id', externalId)");
    // The two predicates are never applied as separate EXISTS queries.
    expect(source).not.toContain("case 'external_system':");
    expect(source).not.toContain("case 'external_id':");
  });

  it('binds a link to the authorized ticket before mutating it', () => {
    const source = readSource('../../../lib/api/controllers/ApiTicketController.ts');
    const bindingCheck = source.indexOf('!before.some((link) => link.link_id === linkId)');
    const mutation = source.indexOf('const result = await updateExternalLink(linkId, data);');

    expect(bindingCheck).toBeGreaterThan(-1);
    expect(mutation).toBeGreaterThan(bindingCheck);
    expect(source).toContain("throw new NotFoundError('External link not found');");
  });

  it('persists supplied links atomically on ticket and comment create and filters by external link', () => {
    const source = readSource('../../../lib/api/services/TicketService.ts');

    expect(source).toContain('await persistExternalLinksForCreate(');
    expect(source).toContain("entity_type: 'comment' as const");
    expect(source).toContain('handledExternalFilters');
    expect(source).toContain("externalLinkSubquery.andWhere('eel.system', externalSystem)");
    expect(source).toContain('external_entity_links as eel');
  });

  it('publishes all five authenticated endpoints in OpenAPI', () => {
    const source = readSource('../../../lib/api/openapi/routes/workManagementV1.ts');

    expect(source).toContain("method: 'get', path: '/api/v1/tickets/{id}/external-links'");
    expect(source).toContain("method: 'post', path: '/api/v1/tickets/{id}/external-links'");
    expect(source).toContain("method: 'patch', path: '/api/v1/tickets/{id}/external-links/{linkId}'");
    expect(source).toContain("method: 'delete', path: '/api/v1/tickets/{id}/external-links/{linkId}'");
    expect(source).toContain("method: 'get', path: '/api/v1/tickets/by-external-link'");
    expect(source).toContain('request: { params: ExternalLinkParams, body: { schema: ExternalLinkUpdateBody } }');
    expect(source).toContain('request: { query: ExternalLinkLookupQuery }');
  });
});
