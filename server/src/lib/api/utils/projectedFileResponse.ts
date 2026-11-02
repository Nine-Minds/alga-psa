import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { AuthorizedProjection } from '../controllers/authorizationKernel';

export interface FileResponseMetadata {
  fileName?: string;
  mimeType?: string | null;
  fileId?: string;
  disposition?: 'attachment' | 'inline';
}

/** Binary bodies are authorized separately; every header and validator comes from projected metadata. */
export function createProjectedFileResponse(
  request: Request,
  body: Uint8Array,
  metadata: AuthorizedProjection<FileResponseMetadata>,
): NextResponse {
  const mimeType = metadata.mimeType || 'application/octet-stream';
  const headers = new Headers({ 'Content-Type': mimeType });
  if (metadata.disposition) {
    const filename = metadata.fileName ? `; filename="${encodeURIComponent(metadata.fileName)}"` : '';
    headers.set('Content-Disposition', `${metadata.disposition}${filename}`);
  }

  if (metadata.fileId) {
    // A policy change that hides a header changes the validator too. Never hash an unprojected value.
    const representation = [metadata.fileId, mimeType, metadata.fileName ?? null, metadata.disposition ?? null];
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
