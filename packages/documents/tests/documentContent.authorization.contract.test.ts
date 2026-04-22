import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) =>
  readFileSync(path.resolve(__dirname, relativePath), 'utf8');

describe('document content authorization contracts', () => {
  const contentActionsSource = readSource('../src/actions/documentContentActions.ts');
  const blockContentActionsSource = readSource('../src/actions/documentBlockContentActions.ts');

  it('T013: document content helpers require document permissions and authorized parent-document checks', () => {
    expect(contentActionsSource).toContain("import { withAuth, hasPermission } from '@alga-psa/auth';");
    expect(contentActionsSource).toContain('getAuthorizedDocumentById');
    expect(contentActionsSource).toContain("return permissionError('Permission denied: Cannot read documents');");
    expect(contentActionsSource).toContain("return permissionError('Permission denied: Cannot update documents');");
    expect(contentActionsSource).toContain("return permissionError('Permission denied: Cannot delete documents');");
    expect(contentActionsSource).toContain('export const getDocumentContent = withAuth(async');
    expect(contentActionsSource).toContain('export const updateDocumentContent = withAuth(async');
    expect(contentActionsSource).toContain('export const deleteDocumentContent = withAuth(async');
  });

  it('T013: document block-content helpers require document permissions and authorized parent-document checks', () => {
    expect(blockContentActionsSource).toContain("import { withAuth, hasPermission } from '@alga-psa/auth';");
    expect(blockContentActionsSource).toContain('getAuthorizedDocumentById');
    expect(blockContentActionsSource).toContain("return permissionError('Permission denied: Cannot read documents');");
    expect(blockContentActionsSource).toContain("return permissionError('Permission denied: Cannot update documents');");
    expect(blockContentActionsSource).toContain("return permissionError('Permission denied: Cannot delete documents');");
    expect(blockContentActionsSource).toContain('export const getBlockContent = withAuth(async');
    expect(blockContentActionsSource).toContain('export const updateBlockContent = withAuth(async');
    expect(blockContentActionsSource).toContain('export const deleteBlockContent = withAuth(async');
  });
});
