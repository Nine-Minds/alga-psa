import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../../');

const readSource = (relativePath: string) =>
  readFileSync(path.resolve(repoRoot, relativePath), 'utf8');

describe('document URL helper authorization contracts', () => {
  const documentActionsSource = readSource('packages/documents/src/actions/documentActions.ts');
  const downloadRouteSource = readSource('server/src/app/api/documents/[documentId]/download/route.ts');
  const previewRouteSource = readSource('server/src/app/api/documents/[documentId]/preview/route.ts');
  const thumbnailRouteSource = readSource('server/src/app/api/documents/[documentId]/thumbnail/route.ts');
  const viewRouteSource = readSource('server/src/app/api/documents/view/[fileId]/route.ts');

  it('routes resolve document access through kernel-backed authorization helpers', () => {
    expect(downloadRouteSource).toContain('getAuthorizedDocumentById');
    expect(downloadRouteSource).toContain('getAuthorizedDocumentByFileId');
    expect(previewRouteSource).toContain('getAuthorizedDocumentById');
    expect(thumbnailRouteSource).toContain('getAuthorizedDocumentById');
    expect(viewRouteSource).toContain('getAuthorizedDocumentByFileId');
  });

  it('document action URL helpers and image URLs enforce authorized document lookup before returning URLs', () => {
    expect(documentActionsSource).toContain('export async function getAuthorizedDocumentById(');
    expect(documentActionsSource).toContain('export async function getAuthorizedDocumentByFileId(');
    expect(documentActionsSource).toContain('export const getDocumentDownloadUrl = withAuth(async');
    expect(documentActionsSource).toContain('export const getDocumentThumbnailUrl = withAuth(async');
    expect(documentActionsSource).toContain('export const getDocumentPreviewUrl = withAuth(async');
    expect(documentActionsSource).toContain('export const getImageUrl = withAuth(async');
    expect(documentActionsSource).toContain('getAuthorizedDocumentById(trx, tenant, user, documentId)');
    expect(documentActionsSource).toContain('getAuthorizedDocumentByFileId(trx, tenant, user, file_id)');
  });
});
