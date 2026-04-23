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
    expect(source).toContain('export async function getAuthorizedDocumentByFileId(');
    expect(source).toContain('export const getDocumentByContactNameId = withAuth(async');
    expect(source).toContain('export const getDocumentsByContractId = withAuth(async');
    expect(source).toContain('export const getDocumentPreview = withAuth(async (');
    expect(source).toContain('export const getDocumentByFileId = withAuth(async (');
    expect(source).toContain('async function paginateAuthorizedDocuments(input: {');
    expect(source).toContain("export const downloadDocument = withAuth(async (user, { tenant }, documentIdOrFileId: string)");
  });

  it('T016: applies field redaction on allowed records without changing allow/deny decisions', () => {
    expect(source).toContain('function applyDocumentRedactions<T extends object>(document: T, redactedFields: string[]): T');
    expect(source).toContain('if (!document || !decision?.allowed) {');
    expect(source).toContain('authorizedDocuments.push(applyDocumentRedactions(document, decision.redactedFields));');
    expect(source).toContain('redactedFields: decision.redactedFields,');
    expect(source).toContain('return authorizeAndRedactDocuments(trx, tenant, user, documents as IDocument[]);');
    expect(source).toContain('getAuthorizedDocumentByFileId(trx, tenant, user, identifier)');
    expect(source).toContain('getAuthorizedDocumentByFileId(trx, tenant, user, fileId)');
    expect(source).toContain('totalCount: authorizedTotalCount,');
    expect(source).toContain('documents: pagination.documents,');
    expect(source).toContain('total: pagination.totalCount,');
  });

  it('T012: enforces record-level document authorization across mutation and folder-operation surfaces', () => {
    expect(source).toContain('async function assertAuthorizedDocumentSetForMutation(');
    expect(source).toContain("return permissionError('Permission denied: Cannot update documents');");
    expect(source).toContain("'Permission denied: Cannot delete documents'");
    expect(source).toContain("return permissionError('Permission denied: Cannot update document associations');");
    expect(source).toContain("'Permission denied: Cannot move documents'");
    expect(source).toContain("'Permission denied: Cannot update document visibility'");
    expect(source).toContain("'Permission denied: Cannot update folder visibility'");
    expect(source).toContain("'Permission denied: Cannot delete folder'");
    expect(source).toContain('export const updateDocument = withAuth(async');
    expect(source).toContain('export const deleteDocument = withAuth(async');
    expect(source).toContain('export const createDocumentAssociations = withAuth(async');
    expect(source).toContain('export const removeDocumentAssociations = withAuth(async');
    expect(source).toContain('export const associateDocumentWithClient = withAuth(async');
    expect(source).toContain('export const associateDocumentWithContract = withAuth(async');
    expect(source).toContain('export const removeDocumentFromContract = withAuth(async');
    expect(source).toContain('export const moveDocumentsToFolder = withAuth(async');
    expect(source).toContain('export const toggleDocumentVisibility = withAuth(async');
    expect(source).toContain('export const toggleFolderVisibility = withAuth(async');
    expect(source).toContain('export const toggleFolderVisibilityByPath = withAuth(async');
    expect(source).toContain('export const deleteFolder = withAuth(async');
  });

  it('T014: count and folder-stat helpers derive totals from authorized document sets', () => {
    expect(source).toContain('export const getDocumentCountsForEntities = withAuth(async (');
    expect(source).toContain("if (!await hasPermission(user, 'document', 'read')) {");
    expect(source).toContain("return new Map(entityIds.map((entityId) => [entityId, 0]));");
    expect(source).toContain("const rows = await trx('document_associations as da')");
    expect(source).toContain('const authorizedDocuments = await authorizeAndRedactDocuments(');
    expect(source).toContain('const authorizedIds = new Set(authorizedDocuments.map((document) => document.document_id));');
    expect(source).toContain('const countedByEntity = new Map<string, Set<string>>();');
    expect(source).toContain('export const getFolderStats = withAuth(async (');
    expect(source).toContain('const authorizationInput = rows.map');
    expect(source).toContain('documentCount: authorizedDocumentIds.size,');
    expect(source).toContain('async function enrichFolderTreeWithCounts(');
    expect(source).toContain("let documentsQuery = knex('documents as d')");
  });

  it('F020: folder document queries bypass legacy documentPermissionUtils shadow auth filtering', () => {
    expect(source).not.toContain("from '../lib/documentPermissionUtils'");
    expect(source).not.toContain('getEntityTypesForUser');
    expect(source).not.toContain("whereIn('da.entity_type', allowedEntityTypes)");
  });
});
