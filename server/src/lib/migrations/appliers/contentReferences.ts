import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { AMP_CONTENT_COLUMNS, parseAmpContentUri, workspaceFields, type AmpEntityType } from '@alga-psa/migration-spec';
import { rewriteAmpContent } from '@alga-psa/migration-sdk';
import { WORKSPACE_MAPPING } from '../workspaceMapping';
import type { ApplierContext } from './context';

/** Resolve content links after identity creation, like deferred structural references. All target
 * addresses come from this tenant/job's AMP ledger; package strings never become storage paths. */
export async function finalizeAmpContent(knex: Knex, context: ApplierContext): Promise<void> {
  for (const [entity, fields] of Object.entries(AMP_CONTENT_COLUMNS)) {
    const staged = await tenantDb(knex, context.tenant).table('migration_staged_records')
      .where({ migration_job_id: context.migrationJobId, entity_type: entity });
    for (const record of staged) {
      const payload = typeof record.payload === 'string' ? JSON.parse(record.payload) : record.payload;
      const urls = new Set<string>();
      for (const field of fields) if (payload[field] != null) rewriteAmpContent(payload[field], url => { if (parseAmpContentUri(url)) urls.add(url); return url; });
      if (!urls.size) continue;
      await withTransaction(knex, async trx => {
        const own = tenantDb(trx, context.tenant), replacements = new Map<string, string>();
        for (const url of urls) {
          const reference = parseAmpContentUri(url)!;
          if (reference.entityType === 'exclusions') { replacements.set(url, 'about:blank#amp-excluded-content'); continue; }
          let fileRecordId = reference.packageRecordId;
          if (reference.entityType === 'attachments') {
            const file = await own.table('migration_staged_records').where({ migration_job_id: context.migrationJobId, entity_type: 'files' })
              .whereRaw("payload -> 'attachment' ->> 'package_record_id' = ?", [reference.packageRecordId]).first('package_record_id');
            if (!file) throw new Error('Content attachment has no staged file');
            fileRecordId = file.package_record_id;
          }
          const type = reference.entityType === 'documents' ? 'documents' : 'files';
          const id = await context.resolveReference(trx, type, fileRecordId);
          if (!id) throw new Error('Content reference has not been applied');
          const suffix = reference.fragment;
          let native: string;
          if (type === 'files') native = `/api/documents/${reference.representation === 'view' ? 'view' : 'download'}/${id}${suffix}`;
          else if (reference.representation === 'view') {
            const document = await own.table('documents').where({ document_id: id }).first('file_id');
            native = document?.file_id ? `/api/documents/view/${document.file_id}${suffix}` : `/api/documents/${id}/content${suffix}`;
          } else native = `/api/documents/${id}/${reference.representation}${suffix}`;
          replacements.set(url, native);
        }
        const id = await context.resolveReference(trx, entity as AmpEntityType, record.package_record_id);
        if (!id) throw new Error('Content owner has not been applied');
        const rewrite = (url: string) => replacements.get(url) ?? url;
        if (entity === 'tickets') {
          const ticket = await own.table('tickets').where({ ticket_id: id }).forUpdate().first('attributes');
          await own.table('tickets').where({ ticket_id: id }).update({ attributes: { ...(ticket.attributes ?? {}), description: rewriteAmpContent(payload.description, rewrite) } });
        } else if (entity === 'ticket_comments') {
          await own.table('comments').where({ comment_id: id }).update({ note: rewriteAmpContent(payload.body, rewrite) });
        } else {
          const mapping = WORKSPACE_MAPPING[entity as keyof typeof WORKSPACE_MAPPING];
          const update: Record<string, unknown> = {};
          for (const field of fields) if (payload[field] != null) {
            const value = rewriteAmpContent(payload[field], rewrite);
            update[(mapping.columns as Record<string, string>)[field]] = workspaceFields(entity)[field]?.kind === 'json' ? typeof value === 'string' ? value : JSON.stringify(value) : value;
          }
          await own.table(mapping.table).where({ [mapping.key]: id }).update(update);
        }
      });
    }
  }
}
