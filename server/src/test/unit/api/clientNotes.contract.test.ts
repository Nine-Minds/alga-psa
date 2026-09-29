import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relative: string): string {
  return fs.readFileSync(path.resolve(__dirname, relative), 'utf8');
}

describe('Client notes API contract', () => {
  it('exposes the client notes document through the v1 API for API-key callers', () => {
    const source = readSource('../../../app/api/v1/clients/[id]/notes/route.ts');

    expect(source).toContain("from '@alga-psa/clients/actions/clientNoteActions'");
    expect(source).toContain('runWithApiKeyOrSession(request, () => getClientNoteContent(id))');
    expect(source).toContain('runWithApiKeyOrSession(request, () => saveClientNote(id, payload))');
    expect(source).toContain('runWithApiKeyOrSession(request, () => deleteClientNote(id, deleteDocument))');
    expect(source).toContain("export const dynamic = 'force-dynamic';");
  });

  it('documents the client notes routes in the OpenAPI registry', () => {
    const source = readSource('../../../lib/api/openapi/routes/clientsContacts.ts');

    for (const method of ['get', 'put', 'delete']) {
      expect(source).toContain(`method: '${method}', path: '/api/v1/clients/{id}/notes'`);
    }
  });

  it('keeps saveClientNote guarded by the client update permission', () => {
    const source = readSource('../../../../../packages/clients/src/actions/clientNoteActions.ts');

    expect(source).toContain("export const saveClientNote = withAuth(");
    expect(source).toContain("assertMspPermission(user, 'client', 'update'");
  });
});
