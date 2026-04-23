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
    expect(source).toContain('await this.assertTicketReadAllowed(apiRequest, id, knex);');
  });
});
