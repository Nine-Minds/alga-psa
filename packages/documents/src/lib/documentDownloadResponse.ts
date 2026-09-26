export function createDocumentDownloadResponse(
  buffer: Buffer,
  metadata: { mime_type?: string | null },
  document: { document_name?: string | null; file_id?: string | null },
): Response {
  const headers = new Headers();
  headers.set('Content-Type', metadata.mime_type || 'application/octet-stream');

  // The extended parameter preserves Unicode; filename remains a compatible
  // ASCII fallback for clients that do not understand filename*.
  const documentName = document.document_name || 'download';
  // encodeURIComponent leaves characters that are not valid unescaped in an
  // RFC 5987 value. Percent-encode those as UTF-8 bytes as well.
  const encodedFilename = encodeURIComponent(documentName).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
  const asciiFilename = documentName.replace(/[^\x00-\x7F]/g, '_');
  headers.set('Content-Disposition', `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`);
  headers.set('Content-Length', buffer.length.toString());

  if (metadata.mime_type?.startsWith('image/')) {
    headers.set('Cache-Control', 'private, no-store');
    if (document.file_id) headers.set('ETag', `"${document.file_id}"`);
  } else {
    headers.set('Cache-Control', 'no-cache');
  }

  return new Response(buffer as any, { status: 200, headers });
}
