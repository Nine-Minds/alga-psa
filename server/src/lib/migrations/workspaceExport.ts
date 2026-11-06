import { readTimeEntryBillingMode } from '@alga-psa/co-managed/timeEntryBillingMode';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { AMP_LIMITS, AMP_LINK_TARGETS, AMP_ENTITY_TABLES, AMP_ENTITY_REFERENCES, AMP_WORKSPACE_TABLES, workspaceFields, type AmpEntityType, type AmpPackageRows } from '@alga-psa/migration-spec';
import { WORKSPACE_MAPPING } from './workspaceMapping';

export const workspaceId = (entity: string, id: unknown): string => {
  const prefix: Record<string, string> = { organizations: 'org-', contacts: 'contact-', locations: 'loc-', tickets: 'ticket-', ticket_comments: 'comment-', assets: 'asset-' };
  return `${prefix[entity] ?? `${entity}:`}${id}`;
};

/** One explicit extractor map; every query shares the caller's tenant and MVCC snapshot. */
export async function exportWorkspaceRecords(trx: Knex.Transaction, tenant: string, rows: AmpPackageRows): Promise<void> {
  const own = tenantDb(trx, tenant);
  const output = rows as Record<string, Record<string, unknown>[]>;
  const exclude = (reason: 'deferred' | 'msp_private' | 'commercial', detail: string) => {
    rows.exclusions = [...(rows.exclusions ?? []), { package_record_id: `workspace-exclusion-${rows.exclusions?.length ?? 0}`, reason, detail }];
  };
  for (const entity of AMP_WORKSPACE_TABLES) {
    const mapping = WORKSPACE_MAPPING[entity];
    if (!await trx.schema.hasTable(mapping.table)) {
      exclude('deferred', `${entity}: this installation does not provision the domain.`);
      continue;
    }
    const fields = workspaceFields(entity);
    const identity = 'identity' in mapping ? mapping.identity : [mapping.key];
    const columns = new Set<string>([...identity, ...Object.values(mapping.columns)]);
    if (entity === 'time_records' || entity === 'calendar_entries') columns.add('work_item_type');
    if (entity === 'project_states') columns.add('standard_status_id');
    // Only declared columns are admitted; created/updated timestamps are optional on native catalogs.
    const info = await trx(mapping.table).columnInfo();
    for (const timestamp of ['created_at', 'updated_at']) if (info[timestamp]) columns.add(timestamp);
    const missing = [...columns].filter(column => !info[column]);
    if (missing.length) exclude('deferred', `${entity}: this installation does not provision fields ${missing.join(', ')}.`);
    for (const column of missing) columns.delete(column);
    let query = own.table(mapping.table).select([...columns]).orderBy([...identity]).limit(AMP_LIMITS.rowsPerEntity + 1);
    if (entity === 'work_messages') {
      query = query.whereNull('deleted_at');
    }
    let native = await query;
    if (native.length > AMP_LIMITS.rowsPerEntity) throw new Error(`AMP ${entity} row limit exceeded`);
    if (entity === 'time_records') {
      const operational: typeof native = [];
      for (const row of native) {
        if (await readTimeEntryBillingMode(trx, tenant, String(row[mapping.key])) === 'operational') operational.push(row);
      }
      if (operational.length !== native.length) exclude('commercial', `${native.length - operational.length} commercial time record(s) excluded by the authoritative per-entry billing-mode reader.`);
      native = operational;
    }
    if (native.length > AMP_LIMITS.rowsPerEntity) throw new Error(`AMP ${entity} row limit exceeded`);
    const standardNames = new Map<string, string>();
    if (entity === 'project_states') {
      const referenced = [...new Set(native.map(row => row.standard_status_id).filter(Boolean))];
      if (referenced.length) {
        const standards = await own.unscoped('standard_statuses', 'AMP resolves only global status names referenced by this tenant project graph').whereIn('standard_status_id', referenced).select('standard_status_id', 'name');
        for (const row of standards) standardNames.set(row.standard_status_id, row.name);
      }
    }
    output[entity] = native.map(source => {
      const sourceIdentity = identity.map(column => String(source[column])).join(':');
      const row: Record<string, unknown> = {
        package_record_id: workspaceId(entity, sourceIdentity), source_record_id: sourceIdentity,
        external_identifier_namespace: `alga:${tenant}`,
        created_at: timestamp(source.created_at), updated_at: timestamp(source.updated_at),
      };
      for (const [column, nativeColumn] of Object.entries(mapping.columns)) {
        const field = fields[column];
        let value = source[nativeColumn];
        if (entity === 'conversation_threads' && nativeColumn === 'root_comment_id' && (field.target === 'ticket_comments' && source.project_task_id || field.target === 'work_messages' && !source.project_task_id)) value = null;
        if ((entity === 'time_records' || entity === 'calendar_entries') && nativeColumn === 'work_item_id') {
          // One native polymorphic edge becomes two typed, mutually exclusive AMP edges.
          const type = source.work_item_type;
          if (field.target === 'tickets' && type !== 'ticket' || field.target === 'work_items' && !['project_task', 'project task'].includes(String(type).toLowerCase())) value = null;
        }
        if (value == null) row[column] = null;
        else if (field.kind === 'reference') row[column] = workspaceId(field.target!, value);
        else if (field.kind === 'json') row[column] = typeof value === 'string' ? value : JSON.stringify(value);
        else if (field.kind === 'flag') row[column] = value ? 1 : 0;
        else if (field.kind === 'number' || field.kind === 'integer') row[column] = Number(value);
        else if (field.kind === 'timestamp') row[column] = timestamp(value);
        else if (field.kind === 'date') row[column] = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
        else row[column] = String(value);
      }
      if (entity === 'project_states' && !row.name && source.standard_status_id) row.name = standardNames.get(source.standard_status_id) ?? null;
      return row;
    });
  }
  // Asset attributes are user-defined business fields, not an opaque dump of native storage.
  // Only keys declared by the exported inventory type schema travel in AMP's custom-field form.
  const assetTypes = new Map((output.asset_kinds ?? []).map(row => [row.slug, typeof row.fields === 'string' ? JSON.parse(row.fields) : []]));
  const assetRows = await own.table('assets').select('asset_id', 'asset_type', 'attributes');
  for (const asset of assetRows) {
    const attributes = asset.attributes ?? {}, declared = new Set<string>((assetTypes.get(asset.asset_type) ?? []).map((field: { key: string }) => field.key));
    for (const [name, value] of Object.entries(attributes)) {
      if (['manufacturer', 'model'].includes(name)) continue; // first-class AMP columns
      if (!declared.has(name)) { exclude('deferred', 'An inventory attribute without a declared field schema was excluded.'); continue; }
      rows.custom_field_values = [...(rows.custom_field_values ?? []), { package_record_id: `asset-field:${rows.custom_field_values?.length ?? 0}`, entity_type: 'assets',
        entity_package_record_id: workspaceId('assets', asset.asset_id), field_name: name, value_json: JSON.stringify(value) }];
    }
  }
  // Imported workflow task history is inert audit evidence, not a live execution. Its canonical
  // fields and resolved native references are retained there so the next AMP export loses nothing.
  const historical = await own.table('audit_logs').where({ operation: 'amp_workflow_history_imported' }).select('audit_id', 'details');
  for (const audit of historical) {
    const details = typeof audit.details === 'string' ? JSON.parse(audit.details) : audit.details;
    const entity = details?.amp_entity;
    if (entity !== 'workflow_tasks' && entity !== 'workflow_history') continue;
    const record = details.amp_record;
    if (!record || typeof record !== 'object') continue;
    const restored: Record<string, unknown> = { package_record_id: workspaceId(entity, audit.audit_id), source_record_id: audit.audit_id,
      external_identifier_namespace: `alga:${tenant}`, created_at: record.created_at ?? null, updated_at: record.updated_at ?? null,
      extension_json: JSON.stringify({ 'amp:source_identity': { namespace: record.external_identifier_namespace, source_record_id: record.source_record_id } }) };
    for (const [column, field] of Object.entries(workspaceFields(entity))) {
      const reference = details.amp_references?.[column];
      restored[column] = field.kind === 'reference' ? reference?.id && reference.entityType === field.target ? workspaceId(field.target!, reference.id) : null : record[column] ?? null;
    }
    output[entity] = [...(output[entity] ?? []), restored];
  }
  const sheets = new Set((output.time_records ?? []).map(row => row.sheet_package_record_id).filter(Boolean));
  output.time_sheets = (output.time_sheets ?? []).filter(row => sheets.has(row.package_record_id));
  const periods = new Set(output.time_sheets.map(row => row.period_package_record_id));
  output.time_periods = (output.time_periods ?? []).filter(row => periods.has(row.package_record_id));

  // Never export billing-generated documents, private/draft conversation files, or their bytes.
  const documents = await own.table('documents').select('document_id', 'file_id', 'thumbnail_file_id', 'preview_file_id', 'source_template_id');
  const associations = await own.table('document_associations').select('document_id', 'entity_type', 'entity_id');
  const blocked = new Set(documents.filter(row => row.source_template_id != null).map(row => String(row.document_id)));
  for (const link of associations) if (['product', 'products', 'vendor_product', 'vendor_products', 'invoice', 'contract', 'billing_plan'].includes(String(link.entity_type)) || !DOCUMENT_TARGET_TYPES[String(link.entity_type)]) blocked.add(String(link.document_id));
  if (await trx.schema.hasTable('ticket_comment_attachments')) {
    const attachments = await own.table('ticket_comment_attachments').select('document_id', 'comment_id', 'state');
    const comments = new Set((rows.ticket_comments ?? []).map(row => row.source_record_id));
    for (const attachment of attachments) if (attachment.state !== 'attached' || !comments.has(String(attachment.comment_id))) blocked.add(String(attachment.document_id));
  }
  const blockedFiles = new Set(documents.filter(row => blocked.has(String(row.document_id))).flatMap(row => [row.file_id, row.thumbnail_file_id, row.preview_file_id]).filter(Boolean).map(String));
  // A file shared with an admitted document is still legitimate workspace content.
  for (const row of documents) if (!blocked.has(String(row.document_id))) for (const id of [row.file_id, row.thumbnail_file_id, row.preview_file_id]) blockedFiles.delete(String(id));
  output.documents = (output.documents ?? []).filter(row => !blocked.has(String(row.source_record_id)));
  output.files = (output.files ?? []).filter(row => !blockedFiles.has(String(row.source_record_id)));
  if (blocked.size) exclude('msp_private', `${blocked.size} private, draft, commercial or unclassified document(s), with dependent content, omitted.`);
  const included = new Map(Object.entries(output).map(([entity, records]) => [entity, new Set(records.map(row => String(row.package_record_id)))]));
  for (const linkEntity of ['document_links', 'asset_links']) {
    output[linkEntity] = (output[linkEntity] ?? []).flatMap(row => {
      const entity = DOCUMENT_TARGET_TYPES[String(row.target_type)];
      const id = workspaceId(entity, row.target_id);
      if (!entity || !included.get(entity)?.has(id)) return [];
      return [{ ...row, target_type: entity, target_id: id }];
    });
  }
  output.document_folder_rules = (output.document_folder_rules ?? []).flatMap(row => {
    const target = DOCUMENT_TARGET_TYPES[String(row.kind)];
    if (!target) { exclude('commercial', 'A folder rule for commercial or unclassified content was omitted.'); return []; }
    return [{ ...row, kind: target }];
  });
  // Cross-domain references may point at omitted private/deleted rows. Remove children with required
  // missing parents to a fixed point; optional edges become null, never native or cross-tenant IDs.
  reconcileWorkspaceReferences(rows, exclude);
  output.conversation_threads = (output.conversation_threads ?? []).filter(row => {
    const ticket = row.ticket_package_record_id != null, work = row.work_item_package_record_id != null;
    const valid = ticket !== work && (ticket ? row.root_ticket_message_package_record_id && !row.root_work_message_package_record_id : row.root_work_message_package_record_id && !row.root_ticket_message_package_record_id);
    if (!valid) exclude('deferred', 'Conversation thread metadata without an included root message was excluded. Included message bodies are retained.');
    return Boolean(valid);
  });
  reconcileWorkspaceReferences(rows, exclude);

}

export function reconcileWorkspaceReferences(rows: AmpPackageRows, exclude: (reason: 'deferred' | 'msp_private', detail: string) => void): void {
  const output = rows as Record<string, Record<string, unknown>[]>;
  for (;;) {
    const ids = new Map(Object.entries(output).map(([entity, records]) => [entity, new Set(records.map(row => String(row.package_record_id)))]));
    let removed = 0;
    for (const entity of AMP_ENTITY_TABLES) {
      output[entity] = (output[entity] ?? []).filter(row => {
        for (const edge of AMP_ENTITY_REFERENCES[entity]) {
          const column = edge.column, field = { required: edge.required, target: edge.targetTable };
          if (row[column] == null || !ids.get(field.target!)?.has(String(row[column]))) {
            if (field.required) { removed++; exclude('deferred', `${entity}: a required parent was excluded or unavailable.`); return false; }
            row[column] = null;
          }
        }
        return true;
      });
    }
    if (!removed) break;
  }
}

function timestamp(value: unknown): string | null {
  return value == null ? null : new Date(String(value)).toISOString();
}

/** Native association kinds are translated to AMP entity names at the producer boundary. */
export const DOCUMENT_TARGET_TYPES: Record<string, AmpEntityType> = {
  ...Object.fromEntries(AMP_LINK_TARGETS.map(entity => [entity, entity])),
  team: 'teams',
  tenant: 'workspaces', ticket: 'tickets', client: 'organizations', contact: 'contacts', asset: 'assets', user: 'people',
  project: 'projects', project_task: 'work_items', document: 'documents', interaction: 'interactions',
  schedule_entry: 'calendar_entries', kb_article: 'knowledge_articles',
};
