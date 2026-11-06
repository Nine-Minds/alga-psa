import { AMP_LIMITS } from './limits';

/** Semantic URL-bearing content only. Code, prose UUIDs and arbitrary workflow JSON are not links. */
export const AMP_CONTENT_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  tickets: ['description'], ticket_comments: ['body'], work_items: ['description'], work_messages: ['body', 'markdown'],
  documents: ['body'], document_text: ['body'], document_blocks: ['blocks'], knowledge_templates: ['body'],
};
export interface AmpContentReference {
  entityType: 'files' | 'documents' | 'attachments' | 'exclusions';
  packageRecordId: string;
  representation: 'view' | 'download' | 'thumbnail' | 'preview' | 'content';
  fragment: string;
}
export function ampContentUri(reference: Omit<AmpContentReference, 'fragment'> & { fragment?: string }): string {
  return `amp://${reference.entityType}/${encodeURIComponent(reference.packageRecordId)}/${reference.representation}${reference.fragment ?? ''}`;
}
/** Null means ordinary user-authored/external URL. Malformed AMP references are rejected, never fetched. */
export function parseAmpContentUri(input: string): AmpContentReference | null {
  if (!/^amp:/i.test(input)) return null;
  // Do not let a URL parser normalize opaque identities such as "." or ".." as path segments.
  const match = /^amp:\/\/(files|documents|attachments|exclusions)\/([^/?#]+)\/(view|download|thumbnail|preview|content)(#[^\r\n]*)?$/.exec(input);
  if (!match) throw new Error('Invalid AMP content URI');
  const packageRecordId = decodeURIComponent(match[2]);
  if (!packageRecordId || new TextEncoder().encode(packageRecordId).length > AMP_LIMITS.opaqueIdBytes) throw new Error('Invalid AMP content identity');
  return { entityType: match[1] as AmpContentReference['entityType'], packageRecordId,
    representation: match[3] as AmpContentReference['representation'], fragment: match[4] ?? '' };
}
