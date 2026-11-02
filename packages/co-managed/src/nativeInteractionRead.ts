import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { retainCoManagedWorkspace } from './nativeWorkspace';
import { retainScheduleSource } from './nativeScheduleRead';
import { nativeInteractionMeetingView } from './nativeMeetingRead';
import { lockCoManagedLocalAuthentication, snapshotCoManagedAuthenticatedActor, type CoManagedAuthenticatedActor } from './localAuthentication';
import { authorizeCoManagedLocalRecord, CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { AUTHORIZED_ROW_MAX_PAGE, pageAuthorizedRows } from './pageAuthorizedRows';
import { nativeInteractionCandidates } from './nativeInteractionCandidates';

export interface NativeInteractionFilters {
  search?: string; userId?: string; contactId?: string; clientId?: string; statusId?: string; typeId?: string;
  dateFrom?: Date; dateTo?: Date; page?: number; pageSize?: number;
}

/** Lists and their totals are built from admitted current projections. Hidden
 * parent labels and masked free text cannot become search/filter oracles. */
export async function readCoManagedNativeInteractions(db: Knex, tenant: string, identify: () => Promise<CoManagedAuthenticatedActor>,
  options: { id?: string; filters?: NativeInteractionFilters; entity?: { id: string; type: 'client' | 'contact' | 'ticket' }; paginated?: boolean } = {}) {
  const filters = { ...options.filters }, entity = options.entity ? { ...options.entity } : undefined;
  const page = filters.page ?? 1, pageSize = filters.pageSize ?? 10;
  return withTransaction(db, async trx => {
    if (!await retainCoManagedWorkspace(trx, tenant)) return { handled: false as const };
    if (!Number.isSafeInteger(page) || page < 1 || page > AUTHORIZED_ROW_MAX_PAGE ||
    !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
    [filters.dateFrom, filters.dateTo].some(date => date !== undefined && !Number.isFinite(new Date(date).getTime()))) throw new CoManagedSharedWorkError();
    if (options.id && !isCoManagedUuid(options.id)) throw new CoManagedSharedWorkError();
    const actor = snapshotCoManagedAuthenticatedActor(await identify()); if (actor.tenant !== tenant) throw new CoManagedSharedWorkError();
    const credential = await lockCoManagedLocalAuthentication(trx, actor), owner = tenantDb(trx, tenant);
    if (entity) {
      if (!isCoManagedUuid(entity.id) || !['client', 'contact', 'ticket'].includes(entity.type)) throw new CoManagedSharedWorkError();
      if (entity.type === 'ticket') await retainScheduleSource(trx, actor, credential.subject, { work_item_type: 'ticket', work_item_id: entity.id });
      else {
        const table = entity.type === 'client' ? 'clients' : 'contacts', pk = entity.type === 'client' ? 'client_id' : 'contact_name_id';
        const parent = await owner.table(table).where(pk, entity.id).forShare().first();
        if (!parent) throw new CoManagedSharedWorkError();
        await authorizeCoManagedLocalRecord(trx, actor, credential.subject, entity.type, 'read', { id: entity.id, clientId: parent.client_id });
      }
    }
    const search = filters.search?.trim().toLowerCase();
    const fetchCandidates = async (after: any, limit: number) => nativeInteractionCandidates(owner, filters, after, { id: options.id, entity }, limit);
    const sourceById = new Map<string, Awaited<ReturnType<typeof retainScheduleSource>>>();
    const authorize = async (row: any) => {
      const id = row.interaction_id;
      try {
        const source = await retainScheduleSource(trx, actor, credential.subject, { work_item_type: 'interaction', work_item_id: id });
        sourceById.set(id, source);
        const locked = await owner.table('interactions').where('interaction_id', id).forShare().first();
        if (!locked) throw new CoManagedSharedWorkError();
        Object.assign(row, locked);
        const hidden = (...keys: string[]) => isCoManagedReadFieldHidden(source.fields, keys.flatMap(key => [key, `interactions.${key}`, `values.${key}`]));
        if (hidden('tenant', 'interaction_id')) throw new CoManagedSharedWorkError();
        const view: any = { tenant, interaction_id: id };
        for (const key of ['type_id', 'contact_name_id', 'client_id', 'user_id', 'ticket_id', 'title', 'notes', 'interaction_date', 'start_time', 'end_time', 'duration', 'status_id']) if (!hidden(key)) view[key] = row[key];
        const label = async (table: string, pk: string, parentId: string, resource: string, map: Record<string, string>) => {
          if (!parentId) return;
          try {
            const parent = await owner.table(table).where(pk, parentId).forShare().first();
            if (!parent || table === 'contacts' && parent.client_id !== row.client_id) return;
            const decision = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, resource, 'read', { id: parentId,
              clientId: parent.client_id, ownerUserId: resource === 'user' ? parentId : undefined });
            for (const [key, column] of Object.entries(map)) if (!hidden(key) && !isCoManagedReadFieldHidden(decision.redactedFields, [column, `${table}.${column}`, `values.${column}`])) view[key] = parent[column];
          } catch (error) { if (!(error instanceof CoManagedSharedWorkError)) throw error; }
        };
        if (view.client_id) await label('clients', 'client_id', row.client_id, 'client', { client_name: 'client_name' });
        if (view.contact_name_id) await label('contacts', 'contact_name_id', row.contact_name_id, 'contact', { contact_name: 'full_name' });
        if (view.user_id) await label('users', 'user_id', row.user_id, 'user', { user_name: 'username' });
        if (view.type_id) {
          const type = await owner.table('interaction_types').where('type_id', row.type_id).forShare().first('type_name', 'icon')
            ?? await owner.table('system_interaction_types').where('type_id', row.type_id).forShare().first('type_name', 'icon');
          if (!hidden('type_name')) view.type_name = type?.type_name?.toLowerCase() ?? null;
          if (!hidden('icon')) view.icon = type?.icon ?? null;
        }
        if (view.status_id) {
          const status = await owner.table('statuses').where({ status_id: row.status_id, status_type: 'interaction' }).forShare().first('name', 'is_closed');
          if (!hidden('status_name')) view.status_name = status?.name ?? null;
          if (!hidden('is_status_closed')) view.is_status_closed = status?.is_closed ?? null;
        }
        view.online_meeting = null;
        return view;
      } catch (error) { if (!(error instanceof CoManagedSharedWorkError) || options.id) throw error; }
      return null;
    };
    // Split the four-window request budget evenly: one pass assembles the page,
    // the other computes a bounded authorized total. Search remains in authorize,
    // after redaction and label authorization.
    const matches = (view: any) => {
      const fields: Record<string, string> = { userId: 'user_id', contactId: 'contact_name_id', clientId: 'client_id', statusId: 'status_id', typeId: 'type_id' };
      if (options.id && view.interaction_id !== options.id) return false;
      if (entity && view[entity.type === 'contact' ? 'contact_name_id' : `${entity.type}_id`] !== entity.id) return false;
      if (Object.entries(fields).some(([filter, field]) => filters[filter as keyof NativeInteractionFilters] != null &&
          view[field] !== filters[filter as keyof NativeInteractionFilters])) return false;
      const time = view.interaction_date == null ? NaN : new Date(view.interaction_date).getTime();
      return !(filters.dateFrom && (!Number.isFinite(time) || time < new Date(filters.dateFrom).getTime()) ||
        filters.dateTo && (!Number.isFinite(time) || time > new Date(filters.dateTo).getTime()));
    };
    const result = await pageAuthorizedRows({ page: options.paginated ? page : 1, pageSize: options.paginated ? pageSize : 100,
      maxWindows: 2, fetchCandidates, authorize, matches,
      searchMatches: view => !search || ['title', 'notes', 'contact_name', 'client_name', 'user_name'].some(key => String(view[key] ?? '').toLowerCase().includes(search)) });
    const count = await pageAuthorizedRows({ page: 1, pageSize: 1, maxWindows: 2, fetchCandidates, authorize, matches,
      searchMatches: view => !search || ['title', 'notes', 'contact_name', 'client_name', 'user_name'].some(key => String(view[key] ?? '').toLowerCase().includes(search)) });
    for (const view of result.rows) {
      const source = sourceById.get(view.interaction_id)!;
      view.online_meeting = source.fields.length ? null : await nativeInteractionMeetingView(trx, actor, credential.subject, view.interaction_id);
    }
    await credential.assertCurrent();
    return { handled: true as const, interactions: result.rows, total: count.total, totalExact: count.totalExact, page, pageSize };
  });
}
