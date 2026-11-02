import type { Knex } from 'knex';
import type { TenantDb } from '@alga-psa/db';
import type { NativeInteractionFilters } from './nativeInteractionRead';

/** Build the tenant-scoped, structurally filtered keyset window before rows are
 * materialized. Free text deliberately stays in the post-authorization phase. */
export function nativeInteractionCandidates(owner: TenantDb, filters: NativeInteractionFilters,
  after: { interaction_date: Date | string | null; interaction_id: string } | null,
  options: { id?: string; entity?: { id: string; type: 'client' | 'contact' | 'ticket' } }, limit: number) {
  const query = owner.table('interactions');
  if (options.id) query.where('interaction_id', options.id);
  for (const [filter, column] of Object.entries({ userId: 'user_id', contactId: 'contact_name_id', clientId: 'client_id', statusId: 'status_id', typeId: 'type_id' })) {
    const value = filters[filter as keyof NativeInteractionFilters]; if (value != null) query.where(column, value);
  }
  if (filters.dateFrom) query.where('interaction_date', '>=', filters.dateFrom);
  if (filters.dateTo) query.where('interaction_date', '<=', filters.dateTo);
  if (options.entity) query.where(options.entity.type === 'contact' ? 'contact_name_id' : `${options.entity.type}_id`, options.entity.id);
  if (after) query.andWhere(function(this: Knex.QueryBuilder) {
    if (after.interaction_date == null) this.whereNull('interaction_date').andWhere('interaction_id', '>', after.interaction_id);
    else this.where('interaction_date', '<', after.interaction_date).orWhere(function() {
      this.where('interaction_date', after.interaction_date).andWhere('interaction_id', '>', after.interaction_id);
    }).orWhereNull('interaction_date');
  });
  return query.orderByRaw('interaction_date DESC NULLS LAST').orderBy('interaction_id', 'asc').limit(limit).select('*');
}
