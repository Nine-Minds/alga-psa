import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readControllerSource(): string {
  const filePath = path.resolve(__dirname, '../../../lib/api/controllers/ApiTicketController.ts');
  return fs.readFileSync(filePath, 'utf8');
}

describe('Ticket materials controller contract', () => {
  it('authenticates reads and writes through the shared controller flow', () => {
    const source = readControllerSource();

    expect(source).toContain('getMaterials()');
    expect(source).toContain('addMaterial()');
    expect(source).toContain('const apiRequest = await this.authenticate(req);');
    expect(source).toContain("await this.checkPermission(apiRequest, this.options.permissions?.read || 'read');");
    expect(source).toContain("await this.checkPermission(apiRequest, this.options.permissions?.update || 'update');");
  });

  it('T034: validates POST bodies with createTicketMaterialSchema before calling the service', () => {
    const source = readControllerSource();

    expect(source).toContain('const validatedData = await this.validateData(apiRequest, createTicketMaterialSchema);');
    expect(source).toContain('const material = await this.ticketService.addTicketMaterial(ticketId, validatedData, apiRequest.context!);');
    expect(source).toContain('return createSuccessResponse(material, 201, undefined, apiRequest);');
  });
});
