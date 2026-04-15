import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readControllerSource(): string {
  const filePath = path.resolve(__dirname, '../../../lib/api/controllers/ApiTicketController.ts');
  return fs.readFileSync(filePath, 'utf8');
}

describe('Ticket document upload controller contract', () => {
  it('T016: authenticates uploads through the shared API-key controller flow', () => {
    const source = readControllerSource();

    expect(source).toContain('uploadDocument()');
    expect(source).toContain('const apiRequest = await this.authenticate(req);');
    expect(source).toContain("await this.checkPermission(apiRequest, this.options.permissions?.update || 'update');");
  });

  it('validates multipart file presence before delegating to the service', () => {
    const source = readControllerSource();

    expect(source).toContain('const formData = await req.formData();');
    expect(source).toContain("const file = formData.get('file');");
    expect(source).toContain('if (!(file instanceof File)) {');
    expect(source).toContain("path: ['file']");
    expect(source).toContain('const document = await this.ticketService.uploadTicketDocument(ticketId, file, apiRequest.context!);');
    expect(source).toContain('return createSuccessResponse(document, 201, undefined, apiRequest);');
  });
});
