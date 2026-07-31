import type { Knex } from 'knex';
import {
  BaseService,
  type ListOptions,
  type ListResult,
  type ServiceContext,
  tenantDb,
  withTransaction,
} from '@alga-psa/db';
import type { IInteraction } from '@alga-psa/types';
import { createInteractionWithSideEffects } from '@alga-psa/clients/actions/interactionCreateHelper';
import type {
  CreateInteractionApi,
  InteractionTypeResponse,
} from '../schemas/interactionSchemas';

export interface InteractionListOptions extends ListOptions {
  client_id?: string;
  contact_id?: string;
  opportunity_id?: string;
  ticket_id?: string;
  project_id?: string;
  user_id?: string;
  type_id?: string;
  date_from?: string;
  date_to?: string;
  page_size?: number;
}

export type InteractionApiRow = Omit<IInteraction, 'type_name'> & {
  type_name: string | null;
  project_id?: string | null;
  visibility?: 'internal' | 'client_visible';
};

type InteractionCreateHelperInput = Parameters<
  typeof createInteractionWithSideEffects
>[0]['interactionData'] & {
  project_id?: string | null;
};

const FILTER_COLUMNS: Record<string, string> = {
  client_id: 'i.client_id',
  contact_id: 'i.contact_name_id',
  opportunity_id: 'i.opportunity_id',
  ticket_id: 'i.ticket_id',
  project_id: 'i.project_id',
  user_id: 'i.user_id',
  type_id: 'i.type_id',
};

function applyInteractionFilters(
  query: Knex.QueryBuilder,
  options: InteractionListOptions,
): Knex.QueryBuilder {
  for (const [filter, column] of Object.entries(FILTER_COLUMNS)) {
    const value = options[filter as keyof InteractionListOptions];
    if (typeof value === 'string' && value) {
      query.where(column, value);
    }
  }

  if (options.date_from) {
    query.where('i.interaction_date', '>=', options.date_from);
  }
  if (options.date_to) {
    query.where('i.interaction_date', '<=', options.date_to);
  }

  return query;
}

function buildHydratedInteractionQuery(knex: Knex, tenant: string): Knex.QueryBuilder {
  const scopedDb = tenantDb(knex, tenant);
  const query = scopedDb.table('interactions as i');
  scopedDb.tenantJoin(query, 'interaction_types as it', 'i.type_id', 'it.type_id', { type: 'left' });
  scopedDb.tenantJoin(query, 'system_interaction_types as sit', 'i.type_id', 'sit.type_id', { type: 'left' });
  scopedDb.tenantJoin(query, 'contacts as c', 'i.contact_name_id', 'c.contact_name_id', { type: 'left' });
  scopedDb.tenantJoin(query, 'clients as cl', 'i.client_id', 'cl.client_id', { type: 'left' });
  scopedDb.tenantJoin(query, 'users as u', 'i.user_id', 'u.user_id', { type: 'left' });
  scopedDb.tenantJoin(query, 'statuses as s', 'i.status_id', 's.status_id', { type: 'left' });

  return query.select(
    'i.*',
    knex.raw('COALESCE(it.type_name, sit.type_name) as type_name'),
    knex.raw('COALESCE(it.icon, sit.icon) as icon'),
    'c.full_name as contact_name',
    'cl.client_name',
    'u.username as user_name',
    's.name as status_name',
    's.is_closed as is_status_closed',
  );
}

function normalizeInteractionRow(row: InteractionApiRow): InteractionApiRow {
  return {
    ...row,
    type_name: row.type_name?.toLowerCase() ?? null,
  };
}

export class InteractionService extends BaseService<InteractionApiRow> {
  constructor() {
    super({
      tableName: 'interactions',
      primaryKey: 'interaction_id',
      tenantColumn: 'tenant',
      searchableFields: ['title', 'notes'],
      defaultSort: 'interaction_date',
      defaultOrder: 'desc',
    });
  }

  async list(
    options: InteractionListOptions,
    context: ServiceContext,
  ): Promise<ListResult<InteractionApiRow>> {
    const knex = await this.getDbForContext(context);
    const page = options.page ?? 1;
    const pageSize = options.page_size ?? options.limit ?? 25;

    const dataQuery = applyInteractionFilters(
      buildHydratedInteractionQuery(knex, context.tenant),
      options,
    )
      .orderBy('i.interaction_date', 'desc')
      .orderBy('i.interaction_id', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const countQuery = applyInteractionFilters(
      tenantDb(knex, context.tenant).table('interactions as i'),
      options,
    );

    const [data, countRow] = await Promise.all([
      dataQuery as Promise<InteractionApiRow[]>,
      countQuery.count('i.interaction_id as count').first() as Promise<{ count: string | number } | undefined>,
    ]);

    return {
      data: data.map(normalizeInteractionRow),
      total: Number(countRow?.count ?? 0),
    };
  }

  async getById(id: string, context: ServiceContext): Promise<InteractionApiRow | null> {
    const knex = await this.getDbForContext(context);
    const interaction = await buildHydratedInteractionQuery(knex, context.tenant)
      .where('i.interaction_id', id)
      .first();
    return interaction
      ? normalizeInteractionRow(interaction as InteractionApiRow)
      : null;
  }

  async create(
    data: CreateInteractionApi | Partial<InteractionApiRow>,
    context: ServiceContext,
  ): Promise<InteractionApiRow> {
    const knex = await this.getDbForContext(context);
    let publishSideEffects: (() => Promise<void>) | undefined;
    const input = data as CreateInteractionApi;

    const interaction = await withTransaction(knex, async (trx) => {
      const interactionData: InteractionCreateHelperInput = {
        type_id: input.type_id,
        client_id: input.client_id ?? null,
        contact_name_id: input.contact_name_id ?? null,
        ticket_id: input.ticket_id ?? null,
        project_id: input.project_id ?? null,
        opportunity_id: input.opportunity_id ?? null,
        title: input.title ?? 'Interaction',
        notes: input.notes,
        duration: input.duration ?? null,
        start_time: input.start_time ? new Date(input.start_time) : undefined,
        end_time: input.end_time ? new Date(input.end_time) : undefined,
        interaction_date: input.interaction_date ? new Date(input.interaction_date) : undefined,
        user_id: context.userId,
      };
      const result = await createInteractionWithSideEffects({
        tenant: context.tenant,
        trx,
        user: context.user,
        interactionData,
      });
      publishSideEffects = result.publishSideEffects;
      return result.interaction;
    });

    await publishSideEffects?.();
    return interaction as InteractionApiRow;
  }

  async listTypes(context: ServiceContext): Promise<InteractionTypeResponse[]> {
    const knex = await this.getDbForContext(context);
    const scopedDb = tenantDb(knex, context.tenant);
    const [systemTypes, tenantTypes] = await Promise.all([
      scopedDb.table('system_interaction_types')
        .select('type_id', 'type_name', 'icon'),
      scopedDb.table('interaction_types')
        .select('type_id', 'type_name', 'icon'),
    ]);

    return [
      ...systemTypes.map((type) => ({
        type_id: type.type_id,
        type_name: type.type_name,
        icon: type.icon ?? null,
        is_system: true,
      })),
      ...tenantTypes.map((type) => ({
        type_id: type.type_id,
        type_name: type.type_name,
        icon: type.icon ?? null,
        is_system: false,
      })),
    ].sort((left, right) => left.type_name.localeCompare(right.type_name));
  }
}
