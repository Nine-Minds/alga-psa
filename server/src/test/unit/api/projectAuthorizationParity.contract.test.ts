import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readControllerSource(): string {
  const filePath = path.resolve(__dirname, '../../../lib/api/controllers/ApiProjectController.ts');
  return fs.readFileSync(filePath, 'utf8');
}

describe('Project controller authorization parity contract', () => {
  it('T036: applies project narrowing to search/export/stats and nested phase/task endpoints', () => {
    const source = readControllerSource();

    expect(source).toContain('private async filterAuthorizedProjects(');
    expect(source).toContain('private async listAllAuthorizedProjects(');
    expect(source).toContain('private async assertPhaseProjectAllowed(');
    expect(source).toContain('private async assertTaskProjectAllowed(');
    expect(source).toContain('private buildTicketRecordContext(ticket: Record<string, any>)');
    expect(source).toContain('const authorizedResult = await this.filterAuthorizedProjects(');
    expect(source).toContain('const authorizedProjects = await this.listAllAuthorizedProjects(apiRequest, knex);');
    expect(source).toContain('const stats = await this.buildProjectStatsFromAuthorizedRows(apiRequest, authorizedProjects, knex);');
    expect(source).toContain('await this.assertPhaseProjectAllowed(apiRequest as AuthenticatedApiRequest, phaseId, knex);');
    expect(source).toContain('await this.assertTaskProjectAllowed(apiRequest as AuthenticatedApiRequest, taskId, knex);');
    expect(source).toContain('recordContext: this.buildTicketRecordContext(ticket),');
    expect(source).toContain('update() {');
    expect(source).toContain('delete() {');
    expect(source).toContain('await this.assertProjectReadAllowed(apiRequest, id, knex);');
  });
});
