import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readRouteSource(): string {
  const filePath = path.resolve(
    __dirname,
    '../../../app/api/documents/[documentId]/content/route.ts',
  );
  return fs.readFileSync(filePath, 'utf8');
}

describe('Document content route contract', () => {
  it('T064: supports API key authentication for AI tool execution', () => {
    // The session-then-API-key block moved into the shared document-route principal.
    expect(readRouteSource()).toContain('resolveDocumentRoutePrincipal(request)');
    const principal = fs.readFileSync(
      path.resolve(__dirname, '../../../lib/api/documentRoutePrincipal.ts'),
      'utf8',
    );

    expect(principal).toContain("request.headers.get('x-api-key')");
    expect(principal).toContain('ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey)');
    expect(principal).toContain('findUserByIdForApi(keyRecord.user_id, keyRecord.tenant)');
    expect(principal).toContain('assertApiPrincipal(apiUser)');
  });

  it('T065: reads both block and text in-app document content tables', () => {
    const source = readRouteSource();

    // Tenant scoping now lives in the tenantDb facade: db.table() scopes both reads.
    expect(source).toContain('const db = tenantDb(knex, tenantId);');
    expect(source).toContain("db.table('document_block_content')");
    expect(source).toContain("db.table('document_content')");
    expect(source).toContain('convertBlockNoteToMarkdown');
  });
});
