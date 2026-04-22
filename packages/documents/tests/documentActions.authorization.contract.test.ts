import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readActionSource = () =>
  readFileSync(path.resolve(__dirname, '../src/actions/documentActions.ts'), 'utf8');

describe('document authorization kernel wiring contracts', () => {
  const source = readActionSource();

  it('T015: preserves own/same-client/client-visible baseline semantics with premium narrowing overlays', () => {
    expect(source).toContain("function getDocumentBuiltinRelationshipRules(user: IUser)");
    expect(source).toContain("return [{ template: 'own' }, { template: 'same_client' }];");
    expect(source).toContain("const selectedClientIds = user.clientId ? [user.clientId] : undefined;");
    expect(source).toContain("const deniedByClientVisibility =");
    expect(source).toContain("user.user_type === 'client' && !isOwnedBySubject && !isClientVisible");
    expect(source).toContain('return await resolveBundleNarrowingRulesForEvaluation(trx, input);');
    expect(source).toContain("export const getDocument = withAuth(async (user, { tenant }, documentId: string)");
    expect(source).toContain("authorizeAndRedactDocuments(trx, tenant, user, [processedDoc])");
    expect(source).toContain("export const getAllDocuments = withAuth(async (");
    expect(source).toContain("export const getDocumentsByEntity = withAuth(async (");
    expect(source).toContain("export const getDocumentsByFolder = withAuth(async (");
    expect(source).toContain("export const downloadDocument = withAuth(async (user, { tenant }, documentIdOrFileId: string)");
  });

  it('T016: applies field redaction on allowed records without changing allow/deny decisions', () => {
    expect(source).toContain('function applyDocumentRedactions<T extends object>(document: T, redactedFields: string[]): T');
    expect(source).toContain('if (!document || !decision?.allowed) {');
    expect(source).toContain('authorizedDocuments.push(applyDocumentRedactions(document, decision.redactedFields));');
    expect(source).toContain('redactedFields: decision.redactedFields,');
  });
});
