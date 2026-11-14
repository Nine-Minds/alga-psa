import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readControllerSource(): string {
  const filePath = path.resolve(__dirname, '../../../lib/api/controllers/ApiTicketController.ts');
  return fs.readFileSync(filePath, 'utf8');
}

describe('Ticket controller authorization parity contract', () => {
  it('T035: applies ticket read narrowing before ticket-scoped subresource reads and mutations', () => {
    const source = readControllerSource();

    expect(source).toContain('private async filterAuthorizedTickets(');
    expect(source).toContain('private buildTicketStatsFromAuthorizedRows(');
    expect(source).toContain('const authorizedResult = await this.filterAuthorizedTickets(');
    expect(source).toContain('const authorizedTickets = await this.listAllAuthorizedTickets(apiRequest, knex);');
    expect(source).toContain('await this.assertTicketReadAllowed(apiRequest, ticketId, knex);');
    expect(source).toContain('const materials = await this.ticketService.getTicketMaterials(ticketId, apiRequest.context!);');
    expect(source).toContain('const material = await this.ticketService.addTicketMaterial(ticketId, validatedData, apiRequest.context!);');
    expect(source).toContain('const comment = await this.ticketService.addComment(');
    expect(source).toContain('const comment = await this.ticketService.updateComment(');
    expect(source).toContain('const updated = await this.ticketService.update(');
    expect(source).toContain('update() {');
    expect(source).toContain('delete() {');
    expect(source).toContain("await this.assertTicketAccess(apiRequest, id, 'update', knex, { alsoRequireRead: true });");
    expect(source).toContain("await this.assertTicketAccess(apiRequest, id, 'delete', knex);");
  });
});

describe('Ticket controller mutation routes request a non-read kernel action', () => {
  // Every ticket mutation route: the kernel action it requests, and whether the `read` decision is
  // required as well. Rule: read is required only where the response body discloses the ticket
  // (ticket record, or ticket-derived fields such as assignee/client). Acknowledgement-only routes
  // (flags, 204, ids, child entities carrying no ticket fields) need only the mutation decision.
  // A mutation route missing from this table, or whose actual `alsoRequireRead` usage differs, fails.
  const MUTATION_ROUTES: Record<string, { action: 'update' | 'delete'; requiresRead: boolean }> = {
    // acknowledgement-only
    createChecklistItem: { action: 'update', requiresRead: false },
    updateChecklistItemCompletion: { action: 'update', requiresRead: false },
    createExternalLink: { action: 'update', requiresRead: false },
    updateExternalLink: { action: 'update', requiresRead: false },
    deleteExternalLink: { action: 'update', requiresRead: false },
    linkAsset: { action: 'update', requiresRead: false },
    unlinkAsset: { action: 'update', requiresRead: false },
    removeAgent: { action: 'update', requiresRead: false },
    uploadDocument: { action: 'update', requiresRead: false },
    deleteDocument: { action: 'update', requiresRead: false },
    addComment: { action: 'update', requiresRead: false },
    cancelScheduledComment: { action: 'update', requiresRead: false },
    updateComment: { action: 'update', requiresRead: false },
    delete: { action: 'delete', requiresRead: false },
    // disclosing
    addWatcher: { action: 'update', requiresRead: true },
    updateWatcher: { action: 'update', requiresRead: true },
    removeWatcher: { action: 'update', requiresRead: true },
    addAgent: { action: 'update', requiresRead: true },
    assignTeam: { action: 'update', requiresRead: true },
    removeTeam: { action: 'update', requiresRead: true },
    addMaterial: { action: 'update', requiresRead: true },
    updateStatus: { action: 'update', requiresRead: true },
    updateAssignment: { action: 'update', requiresRead: true },
    update: { action: 'update', requiresRead: true },
  };

  const METHOD_HEADER = /^  (?:async |private )?([a-zA-Z]+)\(.*\) \{$/gm;

  function routeBody(source: string, name: string): string {
    const re = new RegExp(`^  (?:async )?${name}\\(.*\\) \\{$`, 'm');
    const m = re.exec(source);
    expect(m, `route ${name} exists`).not.toBeNull();
    const rest = source.slice(m!.index + m![0].length);
    const next = /^  (?:\/\*\*|(?:async |private )?[a-zA-Z]+\(.*\) \{$)/m.exec(rest);
    return rest.slice(0, next ? next.index : undefined);
  }

  it('lists every controller method that makes a non-read assertTicketAccess call', () => {
    const source = readControllerSource();
    const found: string[] = [];
    const headers = [...source.matchAll(METHOD_HEADER)];
    headers.forEach((h, i) => {
      const body = source.slice(h.index!, i + 1 < headers.length ? headers[i + 1].index : undefined);
      if (/this\.assertTicketAccess\(apiRequest, \w+, '(?!read')/.test(body)) found.push(h[1]);
    });
    expect(found.sort()).toEqual(Object.keys(MUTATION_ROUTES).sort());
  });

  it.each(Object.entries(MUTATION_ROUTES))('%s: kernel action and read requirement match the table', (name, expected) => {
    const body = routeBody(readControllerSource(), name);
    const calls = [...body.matchAll(/this\.assertTicketAccess\(apiRequest, \w+, '(\w+)', knex(, \{ alsoRequireRead: true \})?\);/g)];
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toBe(expected.action);
    expect(Boolean(calls[0][2])).toBe(expected.requiresRead);
    expect(body).not.toContain('assertTicketReadAllowed');
    // Any in-transaction hook must carry the same read requirement as the pre-check.
    for (const hook of body.matchAll(/buildTicketAuthorizeHook\(apiRequest, '(\w+)'(, \{ alsoRequireRead: true \})?\)/g)) {
      expect(hook[1]).toBe(expected.action);
      expect(Boolean(hook[2])).toBe(expected.requiresRead);
    }
    // No stray alsoRequireRead outside the matched calls.
    const stray = body.split('alsoRequireRead: true').length - 1;
    const hooks = [...body.matchAll(/buildTicketAuthorizeHook\(/g)].length;
    expect(stray).toBe(expected.requiresRead ? 1 + hooks : 0);
  });

  it.each(['updateStatus', 'updateAssignment', 'update'])('%s enforces the decision inside TicketService.update', (name) => {
    expect(routeBody(readControllerSource(), name)).toContain("buildTicketAuthorizeHook(apiRequest, 'update', { alsoRequireRead: true })");
  });

  it('keeps assertTicketReadAllowed as a delegate and TicketService runs the hook after the lock, before writes', () => {
    const source = readControllerSource();
    expect(source).toContain("return this.assertTicketAccess(apiRequest, ticketId, 'read', knex);");
    const svc = fs.readFileSync(path.resolve(__dirname, '../../../lib/api/services/TicketService.ts'), 'utf8');
    const upd = svc.slice(svc.indexOf('async update('));
    expect(upd.indexOf('.forUpdate()')).toBeLessThan(upd.indexOf('await options.authorize('));
    expect(upd.indexOf('await options.authorize(')).toBeLessThan(upd.indexOf('assertHumanWorkAssignee'));
    expect(upd.indexOf('await options.authorize(')).toBeLessThan(upd.indexOf('prepareTicketResourceReassignment'));
  });
});
