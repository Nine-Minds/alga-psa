import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import type { AuthorizationRecord } from '@alga-psa/authorization';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { StorageProviderFactory } from '@alga-psa/storage/StorageProviderFactory';
import { lockCoManagedLocalAuthentication, snapshotCoManagedAuthenticatedActor, type CoManagedAuthenticatedActor } from './localAuthentication';
import { authorizeCoManagedLocalRecord, authorizeCoManagedWorkRecord, CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { coManagedConversationBodySources, coManagedConversationAuthorSources, coManagedConversationAttachmentSources } from './conversationPolicy';
import type { CoManagedSharedResource } from './sharedWork';
import { participationEvidenceTable } from './participationEvidenceStore';
import { coManagedArchiveFilePath } from './archiveFiles';

export interface CoManagedArchiveWork { resource: CoManagedSharedResource; clientId: string; clientName: string | null; title: string | null; ticketNumber: string | null }
export interface CoManagedArchiveEntry {
  id: string; kind: 'conversation' | 'ticket_handoff' | 'work_audit' | 'time_entry' | 'private_conversation'; event: string; occurredAt: string;
  author?: { tenant: string; kind: string; id: string | null; name: string; organization: string };
  audience: string; note: string | null; markdown: string | null; deleted: boolean;
  changes?: Record<string, string | null>;
}
export interface CoManagedArchiveFile { archiveFileId: string; commentId: string; fileName: string; mimeType: string; size: number; audience: 'requester' | 'shared_it' | 'organization_private' }
export interface CoManagedArchiveHistory { work: CoManagedArchiveWork; entries: CoManagedArchiveEntry[]; nextPage: number | null }
const fileSources = [...coManagedConversationBodySources, ...coManagedConversationAttachmentSources, 'co_managed_archive_files', 'archive_files'];
const fileNoteSources = (privateFile: boolean) => privateFile ? ['co_management_private_comments', 'co_management_private_threads'] : ['comments', 'comment_threads'];
const authorSources = [...coManagedConversationAuthorSources, 'actor_kind', 'actor_contact_id', 'actor_name', 'actor_organization'];
const pageNumber = (value: number) => { if (!Number.isSafeInteger(value) || value < 0 || value > 1000000) throw new CoManagedSharedWorkError(); return value; };
function resourceSnapshot(input: CoManagedSharedResource): CoManagedSharedResource {
  if (!input || !['ticket', 'project_task'].includes(input.kind) || ![input.tenant, input.relationshipId, input.id].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  return { tenant: input.tenant.toLowerCase(), relationshipId: input.relationshipId.toLowerCase(), kind: input.kind, id: input.id.toLowerCase() };
}
const sourceKey = (resource: CoManagedSharedResource) => ({ customer_tenant: resource.tenant, relationship_id: resource.relationshipId, resource_type: resource.kind, resource_id: resource.id });
const fileKey = (resource: CoManagedSharedResource) => ({ customer_tenant: resource.tenant, relationship_id: resource.relationshipId, ticket_id: resource.id });
function candidates(trx: Knex.Transaction, tenant: string) {
  const owner = tenantDb(trx, tenant);
  return trx.from(owner.table(participationEvidenceTable).select('customer_tenant', 'relationship_id', 'resource_type', 'resource_id', 'client_id')
    .unionAll(owner.table('co_managed_archive_files').select('customer_tenant', 'relationship_id', { resource_type: trx.raw("'ticket'::text"), resource_id: 'ticket_id' }, 'client_id')).as('retained'));
}
const hidden = (fields: readonly string[], names: readonly string[]) => isCoManagedReadFieldHidden(fields, names.flatMap(name => [name, `tickets.${name}`, `project_tasks.${name}`, `projects.${name}`, `values.${name}`]));
const evidenceHidden = (fields: readonly string[], names: readonly string[]) => hidden(fields, names.flatMap(name => [name, `payload.${name}`, `co_managed_participation_evidence.${name}`, `co_managed_participation_evidence.payload.${name}`]));
const filesHidden = (fields: readonly string[]) => hidden(fields, fileSources.flatMap(name => [name, `co_managed_archive_files.${name}`]));

/** Own retained evidence supplies the MSP client/routing projection. Neither a
 * requested customer UUID nor an active relationship grants archive authority.
 * No customer table, live grant, delegation or foreign user is read here. */
async function admit(trx: Knex.Transaction, credential: Awaited<ReturnType<typeof lockCoManagedLocalAuthentication>>, resource: CoManagedSharedResource) {
  const { actor, subject } = credential, owner = tenantDb(trx, actor.tenant);
  if (actor.tenant === resource.tenant) throw new CoManagedSharedWorkError();
  const identities = await candidates(trx, actor.tenant).where(sourceKey(resource)).distinct('client_id').limit(2);
  if (identities.length !== 1) throw new CoManagedSharedWorkError();
  const clientId = identities[0].client_id;
  const route = await owner.table(resource.kind === 'ticket' ? 'co_managed_ticket_references' : 'co_managed_project_task_references')
    .where({ customer_tenant: resource.tenant, relationship_id: resource.relationshipId, [resource.kind === 'ticket' ? 'ticket_id' : 'task_id']: resource.id, client_id: clientId }).forShare().first();
  const record: AuthorizationRecord = { id: `${resource.tenant}:${resource.kind}:${resource.id}`, clientId, boardId: resource.kind === 'ticket' ? route?.board_id : undefined,
    assignedUserIds: route?.assigned_to ? [route.assigned_to] : [], teamIds: route?.assigned_team_id ? [route.assigned_team_id] : [] };
  const decision = await authorizeCoManagedWorkRecord(trx, actor, subject, resource.kind === 'ticket' ? 'ticket' : 'project', 'read', record);
  const fields = decision.redactedFields;
  if (hidden(fields, ['archive', 'resource', 'customer_tenant', 'relationship_id', 'client_id', resource.kind === 'ticket' ? 'ticket_id' : 'task_id'])) throw new CoManagedSharedWorkError();
  const client = await owner.table('clients').where('client_id', clientId).first('client_name');
  const reference = await owner.table('co_managed_time_work_references').where({ customer_tenant: resource.tenant, relationship_id: resource.relationshipId,
    source_kind: resource.kind, source_id: resource.id, client_id: clientId }).first('title', 'ticket_number');
  const snapshot = await owner.table(participationEvidenceTable).where({ ...sourceKey(resource), client_id: clientId })
    .whereRaw("COALESCE(payload->>'resourceTitle', CASE WHEN source_type = 'time_entry' THEN payload->>'title' END) IS NOT NULL")
    .orderBy('captured_at', 'desc').orderBy('evidence_id').first({ title: trx.raw("COALESCE(payload->>'resourceTitle', payload->>'title')"), ticket_number: trx.raw("payload->>'ticketNumber'") });
  const work: CoManagedArchiveWork = { resource, clientId, clientName: hidden(fields, ['client_name', 'clientName', 'clients.client_name']) ? null : client?.client_name ?? null,
    title: evidenceHidden(fields, ['title', 'resourceTitle', 'task_name', 'name', 'co_managed_time_work_references.title']) ? null : snapshot?.title ?? reference?.title ?? null,
    ticketNumber: evidenceHidden(fields, ['ticket_number', 'ticketNumber', 'co_managed_time_work_references.ticket_number']) ? null : snapshot?.ticket_number ?? reference?.ticket_number ?? null };
  await credential.assertCurrent();
  return { work, fields, record };
}

export async function listCoManagedArchiveWork(db: Knex, inputActor: CoManagedAuthenticatedActor, inputPage = 0) {
  const actor = snapshotCoManagedAuthenticatedActor(inputActor), page = pageNumber(inputPage);
  return withTransaction(db, async trx => {
    const credential = await lockCoManagedLocalAuthentication(trx, actor);
    // Bound each scan. Denied candidates reveal neither identifiers nor totals.
    const rows = await candidates(trx, actor.tenant).distinct('customer_tenant', 'relationship_id', 'resource_type', 'resource_id')
      .orderBy(['customer_tenant', 'relationship_id', 'resource_type', 'resource_id']).offset(page * 25).limit(26);
    const items: CoManagedArchiveWork[] = [];
    for (const row of rows.slice(0, 25)) {
      try { items.push((await admit(trx, credential, { tenant: row.customer_tenant, relationshipId: row.relationship_id, kind: row.resource_type, id: row.resource_id })).work); }
      catch (error) { if (!(error instanceof CoManagedSharedWorkError)) throw error; }
    }
    await credential.assertCurrent();
    return { items, nextPage: rows.length > 25 ? page + 1 : null };
  });
}

export async function getCoManagedArchiveHistory(db: Knex, inputActor: CoManagedAuthenticatedActor, inputResource: CoManagedSharedResource, inputPage = 0): Promise<CoManagedArchiveHistory> {
  const actor = snapshotCoManagedAuthenticatedActor(inputActor), resource = resourceSnapshot(inputResource), page = pageNumber(inputPage);
  return withTransaction(db, async trx => {
    const credential = await lockCoManagedLocalAuthentication(trx, actor), { work, fields, record } = await admit(trx, credential, resource);
    const entries: CoManagedArchiveEntry[] = [];
    if (evidenceHidden(fields, ['history', 'audit_logs', participationEvidenceTable, ...coManagedConversationBodySources])) return { work, entries, nextPage: null };
    const rows = await tenantDb(trx, actor.tenant).table(participationEvidenceTable).where(sourceKey(resource))
      .orderBy('occurred_at', 'desc').orderBy('evidence_id').offset(page * 50).limit(51);
    for (const row of rows.slice(0, 50)) {
      let rowFields = fields;
      if (row.source_type === 'conversation' && hidden(fields, ['comments', 'comment_threads', 'project_task_comments', ...coManagedConversationBodySources.flatMap(name => [`comments.${name}`, `project_task_comments.${name}`])])) continue;
      if (row.source_type === 'ticket_handoff' && hidden(fields, coManagedConversationBodySources.map(name => `co_management_ticket_handoffs.${name}`))) continue;
      if (row.source_type === 'private_conversation' && hidden(fields, ['co_management_private_comments', 'co_management_private_threads', ...coManagedConversationBodySources.flatMap(name => [`co_management_private_comments.${name}`, `co_management_private_threads.${name}`])])) continue;
      if (row.source_type === 'time_entry') {
        try { const decision = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'time_entry', 'read', { ...record, id: row.source_id,
          ownerUserId: row.actor_user_id, assignedUserIds: [row.actor_user_id] });
          rowFields = [...fields, ...decision.redactedFields.map(field => field.replace(/^(fields\.)?time_entries\./, ''))];
          if (hidden(rowFields, ['time_entries', 'entry_id', 'work_item_id', 'created_at'])) continue;
        }
        catch (error) { if (error instanceof CoManagedSharedWorkError) continue; throw error; }
      }
      const payload = row.payload, deleted = payload.deleted === true;
      const entry: CoManagedArchiveEntry = { id: row.evidence_id, kind: row.source_type, event: row.event_type, occurredAt: new Date(row.occurred_at).toISOString(),
        audience: payload.audience, deleted, note: !deleted && typeof payload.note === 'string' ? payload.note : null,
        markdown: !deleted && typeof payload.markdown === 'string' ? payload.markdown : null };
      const authorTables = row.source_type === 'private_conversation' ? ['co_management_private_comments'] : row.source_type === 'ticket_handoff' ? ['co_management_ticket_handoffs'] : ['comments', 'project_task_comments'];
      if (!evidenceHidden(rowFields, [...authorSources, ...authorSources.flatMap(name => authorTables.map(table => `${table}.${name}`))])) entry.author = { tenant: row.actor_tenant, kind: row.actor_kind,
        id: row.actor_user_id ?? row.actor_contact_id, name: row.actor_name, organization: row.actor_organization };
      if (row.source_type === 'work_audit' && payload.changes) {
        entry.changes = {};
        for (const field of ['task_name', 'due_date', 'project_status_mapping_id', 'msp_assignment']) {
          const value = payload.changes[field];
          if ((typeof value === 'string' || value === null) && !evidenceHidden(fields, ['changed_data', `changes.${field}`, `audit_logs.changed_data.${field}`, field, ...(field === 'msp_assignment' ? ['assigned_to', 'assigned_team_id', 'assignment'] : [])])) entry.changes[field] = value;
        }
      }
      entries.push(entry);
    }
    await credential.assertCurrent();
    return { work, entries, nextPage: rows.length > 50 ? page + 1 : null };
  });
}

export async function listCoManagedArchiveFiles(db: Knex, inputActor: CoManagedAuthenticatedActor, inputResource: CoManagedSharedResource, inputPage = 0) {
  const actor = snapshotCoManagedAuthenticatedActor(inputActor), resource = resourceSnapshot(inputResource), page = pageNumber(inputPage);
  return withTransaction(db, async trx => {
    const credential = await lockCoManagedLocalAuthentication(trx, actor), { fields } = await admit(trx, credential, resource);
    const items: CoManagedArchiveFile[] = [];
    if (resource.kind !== 'ticket' || filesHidden(fields)) return { items, nextPage: null };
    const rows = await tenantDb(trx, actor.tenant).table('co_managed_archive_files').where(fileKey(resource)).orderBy('captured_at').orderBy('archive_file_id')
      .modify(query => {
        if (hidden(fields, fileNoteSources(false))) query.whereNot('source_tenant', resource.tenant);
        if (hidden(fields, fileNoteSources(true))) query.whereNot('source_tenant', actor.tenant);
      }).offset(page * 50).limit(51).select('archive_file_id', 'comment_id', 'file_name', 'mime_type', 'file_size', 'audience');
    for (const row of rows.slice(0, 50)) items.push({ archiveFileId: row.archive_file_id, commentId: row.comment_id, fileName: row.file_name, mimeType: row.mime_type, size: row.file_size, audience: row.audience });
    await credential.assertCurrent();
    return { items, nextPage: rows.length > 50 ? page + 1 : null };
  });
}

export async function downloadCoManagedArchiveFile(db: Knex, inputActor: CoManagedAuthenticatedActor, inputResource: CoManagedSharedResource, fileId: string) {
  const actor = snapshotCoManagedAuthenticatedActor(inputActor), resource = resourceSnapshot(inputResource);
  if (!isCoManagedUuid(fileId) || resource.kind !== 'ticket') throw new CoManagedSharedWorkError();
  return withTransaction(db, async trx => {
    const credential = await lockCoManagedLocalAuthentication(trx, actor), { fields } = await admit(trx, credential, resource);
    if (filesHidden(fields)) throw new CoManagedSharedWorkError();
    const row = await tenantDb(trx, actor.tenant).table('co_managed_archive_files').where({ ...fileKey(resource), archive_file_id: fileId }).forShare().first();
    if (!row || hidden(fields, fileNoteSources(row.source_tenant === actor.tenant))) throw new CoManagedSharedWorkError();
    const content = row.status === 'pending' ? Buffer.from(row.staged_bytes) : Buffer.from(await (await StorageProviderFactory.createProvider()).download(coManagedArchiveFilePath(actor.tenant, row.archive_file_id)));
    if (content.length !== row.file_size || createHash('sha256').update(content).digest('hex') !== row.content_hash) throw new Error('Retained archive file failed integrity verification');
    await credential.assertCurrent();
    return { attachment: { fileName: row.file_name }, content };
  });
}
