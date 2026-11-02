import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { buildDocumentPreviewHeaders } from '@alga-psa/core';
import type { AuthorizedProjection } from '../controllers/authorizationKernel';

export interface FileResponseMetadata {
  fileName?: string;
  mimeType?: string | null;
  fileId?: string;
  disposition?: 'attachment' | 'inline';
}

/** Build validators and caching from the final headers, all of which came from projected metadata or its policy. */
function respondWithProjectedFile(
  request: Request,
  body: Uint8Array,
  metadata: AuthorizedProjection<FileResponseMetadata>,
  headers: Headers,
): NextResponse {
  if (metadata.fileId) {
    // Include the final authorized representation headers, never a source file ID or raw service metadata.
    const representation = [metadata.fileId, Array.from(headers.entries()).sort(([a], [b]) => a.localeCompare(b))];
    const etag = `"${createHash('sha256').update(JSON.stringify(representation)).digest('hex')}"`;
    headers.set('ETag', etag);
    // Revalidate authorization on every request, even when the stored file itself is immutable.
    headers.set('Cache-Control', 'private, no-cache');
    if (request.headers.get('if-none-match') === etag) {
      return new NextResponse(null, { status: 304, headers });
    }
  } else {
    headers.set('Cache-Control', 'private, no-store');
  }

  return new NextResponse(new Uint8Array(body), { status: 200, headers });
}

/** Binary bodies are authorized separately; every header and validator comes from projected metadata. */
export function createProjectedFileResponse(
  request: Request,
  body: Uint8Array,
  metadata: AuthorizedProjection<FileResponseMetadata>,
): NextResponse {
  const headers = new Headers({ 'Content-Type': metadata.mimeType || 'application/octet-stream' });
  if (metadata.disposition) {
    const filename = metadata.fileName ? `; filename="${encodeURIComponent(metadata.fileName)}"` : '';
    headers.set('Content-Disposition', `${metadata.disposition}${filename}`);
  }
  return respondWithProjectedFile(request, body, metadata, headers);
}

/** Preview policy is composed from the authorized MIME/name projection before any response headers or validators are set. */
export function createProjectedPreviewResponse(
  request: Request,
  body: Uint8Array,
  metadata: AuthorizedProjection<FileResponseMetadata>,
): NextResponse {
  const headers = new Headers(buildDocumentPreviewHeaders(metadata.mimeType, metadata.fileName));
  return respondWithProjectedFile(request, body, metadata, headers);
}
