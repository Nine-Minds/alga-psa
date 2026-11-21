export const conversationAttachmentHeaders = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'" };
/** Always download as non-executable content; never expose provider URLs. */
export function conversationAttachmentResponse(attachment: { fileName: string }, content: Uint8Array) {
  const ascii = attachment.fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(attachment.fileName).replace(/['()*]/g, value => `%${value.charCodeAt(0).toString(16).toUpperCase()}`);
  return new Response(content as BodyInit, { headers: { ...conversationAttachmentHeaders, 'Content-Type': 'application/octet-stream', 'Content-Length': String(content.length),
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}` } });
}
