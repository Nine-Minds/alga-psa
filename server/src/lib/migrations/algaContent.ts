import { AMP_CONTENT_COLUMNS, ampContentUri, type AmpPackageRows } from '@alga-psa/migration-spec';
import { rewriteAmpContent } from '@alga-psa/migration-sdk';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const FILE = new RegExp(`^/api/documents/(view|download)/(${UUID})([?#].*)?$`, 'i');
const DOCUMENT = new RegExp(`^/api/documents/(${UUID})/(download|thumbnail|preview|content)([?#].*)?$`, 'i');
const CONVERSATION = new RegExp(`^/api/(?:co-management/attachments|client-portal/conversation-attachments)/(${UUID})([?#].*)?$`, 'i');

/** Convert semantic local links, never prose UUIDs or external lookalike URLs. Source request
 * queries can contain ephemeral authorization and are intentionally not an interchange identity. */
export function canonicalizeAlgaContent(rows: AmpPackageRows): void {
  const files = new Map((rows.files ?? []).map(row => [row.source_record_id.toLowerCase(), row.package_record_id]));
  const documents = new Map((rows.documents ?? []).map(row => [row.source_record_id.toLowerCase(), row.package_record_id]));
  const conversation = new Map((rows.attachments ?? []).filter(row => row.package_record_id.startsWith('conversation-file:')).map(row => [row.package_record_id.slice('conversation-file:'.length).toLowerCase(), row.package_record_id]));
  const missing = new Map((rows.exclusions ?? []).filter(row => row.package_record_id.startsWith('unreadable-file:')).map(row => [row.package_record_id.slice('unreadable-file:'.length).toLowerCase(), row.package_record_id]));
  const rewrite = (url: string): string => {
    const file = FILE.exec(url), document = DOCUMENT.exec(url), attachment = CONVERSATION.exec(url);
    if (!file && !document && !attachment) return url;
    const source = (file?.[2] ?? document?.[1] ?? attachment![1]).toLowerCase();
    const suffix = file?.[3] ?? document?.[3] ?? attachment?.[2] ?? '';
    const fragment = suffix.includes('#') ? suffix.slice(suffix.indexOf('#')) : '';
    const representation = (file?.[1] ?? document?.[2] ?? 'download') as 'view' | 'download' | 'thumbnail' | 'preview' | 'content';
    const fileId = file ? files.get(source) : undefined, documentId = !attachment ? documents.get(source) : undefined;
    if (fileId && documentId) throw new Error('Ambiguous Alga file/document content identity');
    const packageRecordId = attachment ? conversation.get(source) : fileId ?? documentId;
    if (packageRecordId) return ampContentUri({ entityType: attachment ? 'attachments' : fileId ? 'files' : 'documents', packageRecordId, representation, fragment });
    let exclusion = missing.get(source);
    if (!exclusion) {
      exclusion = `unavailable-content:${source}`; missing.set(source, exclusion);
      rows.exclusions = [...(rows.exclusions ?? []), { package_record_id: exclusion, reason: 'deferred', detail: 'An inline content link targeted a record or attachment not included in the package.' }];
    }
    return ampContentUri({ entityType: 'exclusions', packageRecordId: exclusion, representation, fragment });
  };
  const entities = rows as Record<string, Record<string, unknown>[]>;
  for (const [entity, columns] of Object.entries(AMP_CONTENT_COLUMNS)) for (const row of entities[entity] ?? []) {
    for (const column of columns) if (row[column] != null) row[column] = rewriteAmpContent(row[column], rewrite);
  }
}
