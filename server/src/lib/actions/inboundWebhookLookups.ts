'use server';

import { withAuth } from '@alga-psa/auth/withAuth';
import { createTenantKnex } from '@alga-psa/db';
import type { IClient, IUser, ITeam } from '@alga-psa/types';

export type InboundWebhookLookupEntityType =
  | 'client'
  | 'board'
  | 'ticket_status'
  | 'ticket_priority'
  | 'ticket_category'
  | 'ticket_subcategory'
  | 'user'
  | 'team'
  | 'contact'
  | 'client_location'
  | 'asset'
  | 'service';

export interface InboundWebhookLookupOption {
  value: string;
  label: string;
  helperLabel?: string;
  group?: string;
}

export interface InboundWebhookLookupRequest {
  entityType: InboundWebhookLookupEntityType;
  search?: string;
  scope?: Record<string, string | undefined>;
  limit?: number;
}

const MAX_RESULTS = 100;

export const listInboundWebhookLookup = withAuth(
  async (
    _user,
    { tenant },
    request: InboundWebhookLookupRequest,
  ): Promise<InboundWebhookLookupOption[]> => {
    const { knex } = await createTenantKnex(tenant);
    const limit = Math.max(1, Math.min(MAX_RESULTS, request.limit ?? MAX_RESULTS));
    const search = (request.search ?? '').trim();
    const scope = request.scope ?? {};

    switch (request.entityType) {
      case 'client': {
        const rows = await knex('clients')
          .select<{ client_id: string; client_name: string; is_inactive: boolean }[]>(
            'client_id',
            'client_name',
            'is_inactive',
          )
          .where({ tenant })
          .modify((query) => {
            if (search) {
              query.andWhereILike('client_name', `%${search}%`);
            }
          })
          .orderBy([
            { column: 'is_inactive', order: 'asc' },
            { column: 'client_name', order: 'asc' },
          ])
          .limit(limit);
        return rows.map((row) => ({
          value: row.client_id,
          label: row.client_name,
          helperLabel: row.is_inactive ? 'inactive' : undefined,
        }));
      }

      case 'board': {
        const rows = await knex('boards')
          .select<{ board_id: string; board_name: string; is_inactive: boolean }[]>(
            'board_id',
            'board_name',
            'is_inactive',
          )
          .where({ tenant })
          .modify((query) => {
            if (search) {
              query.andWhereILike('board_name', `%${search}%`);
            }
          })
          .orderBy([
            { column: 'is_inactive', order: 'asc' },
            { column: 'board_name', order: 'asc' },
          ])
          .limit(limit);
        return rows.map((row) => ({
          value: row.board_id,
          label: row.board_name,
          helperLabel: row.is_inactive ? 'inactive' : undefined,
        }));
      }

      case 'ticket_status': {
        const boardId = scope.board_id;
        const rows = await knex('statuses')
          .select<{ status_id: string; name: string; board_id: string | null; is_default: boolean | null }[]>(
            'status_id',
            'name',
            'board_id',
            'is_default',
          )
          .where({ tenant })
          .andWhere('status_type', 'ticket')
          .modify((query) => {
            if (boardId) {
              query.andWhere('board_id', boardId);
            }
            if (search) {
              query.andWhereILike('name', `%${search}%`);
            }
          })
          .orderBy([
            { column: 'order_number', order: 'asc' },
            { column: 'name', order: 'asc' },
          ])
          .limit(limit);
        return rows.map((row) => ({
          value: row.status_id,
          label: row.name,
          helperLabel: row.is_default ? 'default' : undefined,
        }));
      }

      case 'ticket_priority': {
        const rows = await knex('priorities')
          .select<{ priority_id: string; priority_name: string }[]>('priority_id', 'priority_name')
          .where({ tenant })
          .modify((query) => {
            if (search) {
              query.andWhereILike('priority_name', `%${search}%`);
            }
          })
          .orderBy('order_number', 'asc')
          .orderBy('priority_name', 'asc')
          .limit(limit);
        return rows.map((row) => ({ value: row.priority_id, label: row.priority_name }));
      }

      case 'ticket_category':
      case 'ticket_subcategory': {
        const parentRequired = request.entityType === 'ticket_subcategory';
        const boardId = scope.board_id;
        const parentId = scope.parent_category_id;
        const rows = await knex('categories')
          .select<{ category_id: string; category_name: string; parent_category: string | null; board_id: string | null }[]>(
            'category_id',
            'category_name',
            'parent_category',
            'board_id',
          )
          .where({ tenant })
          .modify((query) => {
            if (parentRequired) {
              query.whereNotNull('parent_category');
              if (parentId) {
                query.andWhere('parent_category', parentId);
              }
            } else {
              query.whereNull('parent_category');
            }
            if (boardId) {
              query.andWhere('board_id', boardId);
            }
            if (search) {
              query.andWhereILike('category_name', `%${search}%`);
            }
          })
          .orderBy('category_name', 'asc')
          .limit(limit);
        return rows.map((row) => ({ value: row.category_id, label: row.category_name }));
      }

      case 'user': {
        const rows = await knex('users')
          .select<{ user_id: string; first_name: string | null; last_name: string | null; email: string | null; is_inactive: boolean }[]>(
            'user_id',
            'first_name',
            'last_name',
            'email',
            'is_inactive',
          )
          .where({ tenant })
          .andWhere('user_type', 'internal')
          .modify((query) => {
            if (search) {
              const like = `%${search}%`;
              query.andWhere((sub) => {
                sub.whereILike('email', like)
                  .orWhereILike('first_name', like)
                  .orWhereILike('last_name', like);
              });
            }
          })
          .orderBy([
            { column: 'is_inactive', order: 'asc' },
            { column: 'last_name', order: 'asc' },
            { column: 'first_name', order: 'asc' },
          ])
          .limit(limit);
        return rows.map((row) => {
          const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.email || row.user_id;
          return {
            value: row.user_id,
            label: name,
            helperLabel: row.email ?? undefined,
          };
        });
      }

      case 'team': {
        const rows = await knex('teams')
          .select<{ team_id: string; team_name: string }[]>('team_id', 'team_name')
          .where({ tenant })
          .modify((query) => {
            if (search) {
              query.andWhereILike('team_name', `%${search}%`);
            }
          })
          .orderBy('team_name', 'asc')
          .limit(limit);
        return rows.map((row) => ({ value: row.team_id, label: row.team_name }));
      }

      case 'contact': {
        const clientId = scope.client_id;
        const rows = await knex('contacts')
          .select<{ contact_name_id: string; full_name: string; email: string | null; client_id: string | null; is_inactive: boolean }[]>(
            'contact_name_id',
            'full_name',
            'email',
            'client_id',
            'is_inactive',
          )
          .where({ tenant })
          .modify((query) => {
            if (clientId) {
              query.andWhere('client_id', clientId);
            }
            if (search) {
              const like = `%${search}%`;
              query.andWhere((sub) => {
                sub.whereILike('full_name', like).orWhereILike('email', like);
              });
            }
          })
          .orderBy([
            { column: 'is_inactive', order: 'asc' },
            { column: 'full_name', order: 'asc' },
          ])
          .limit(limit);
        return rows.map((row) => ({
          value: row.contact_name_id,
          label: row.full_name,
          helperLabel: row.email ?? undefined,
        }));
      }

      case 'client_location': {
        const clientId = scope.client_id;
        const rows = await knex('client_locations')
          .select<{ location_id: string; location_name: string | null; address_line1: string | null; client_id: string }[]>(
            'location_id',
            'location_name',
            'address_line1',
            'client_id',
          )
          .where({ tenant })
          .modify((query) => {
            if (clientId) {
              query.andWhere('client_id', clientId);
            }
            if (search) {
              const like = `%${search}%`;
              query.andWhere((sub) => {
                sub.whereILike('location_name', like).orWhereILike('address_line1', like);
              });
            }
          })
          .orderBy('location_name', 'asc')
          .limit(limit);
        return rows.map((row) => ({
          value: row.location_id,
          label: row.location_name || row.address_line1 || row.location_id,
          helperLabel: row.location_name ? row.address_line1 ?? undefined : undefined,
        }));
      }

      case 'asset': {
        const clientId = scope.client_id;
        const rows = await knex('assets')
          .select<{ asset_id: string; name: string | null; asset_tag: string | null; client_id: string | null; status: string | null }[]>(
            'asset_id',
            'name',
            'asset_tag',
            'client_id',
            'status',
          )
          .where({ tenant })
          .modify((query) => {
            if (clientId) {
              query.andWhere('client_id', clientId);
            }
            if (search) {
              const like = `%${search}%`;
              query.andWhere((sub) => {
                sub.whereILike('name', like).orWhereILike('asset_tag', like);
              });
            }
          })
          .orderBy('name', 'asc')
          .limit(limit);
        return rows.map((row) => ({
          value: row.asset_id,
          label: row.name || row.asset_tag || row.asset_id,
          helperLabel: row.asset_tag && row.name ? row.asset_tag : undefined,
        }));
      }

      case 'service': {
        const rows = await knex('service_catalog')
          .select<{ service_id: string; service_name: string }[]>('service_id', 'service_name')
          .where({ tenant })
          .modify((query) => {
            if (search) {
              query.andWhereILike('service_name', `%${search}%`);
            }
          })
          .orderBy('service_name', 'asc')
          .limit(limit);
        return rows.map((row) => ({ value: row.service_id, label: row.service_name }));
      }

      default:
        return [];
    }
  },
);

export const listClientsForInboundWebhook = withAuth(
  async (_user, { tenant }): Promise<IClient[]> => {
    const { knex } = await createTenantKnex(tenant);
    const rows = await knex<IClient>('clients')
      .where({ tenant })
      .orderBy([
        { column: 'is_inactive', order: 'asc' },
        { column: 'client_name', order: 'asc' },
      ]);
    return rows;
  },
);

export const listUsersForInboundWebhook = withAuth(
  async (_user, { tenant }): Promise<IUser[]> => {
    const { knex } = await createTenantKnex(tenant);
    const rows = await knex<IUser>('users')
      .where({ tenant })
      .andWhere('user_type', 'internal')
      .orderBy([
        { column: 'is_inactive', order: 'asc' },
        { column: 'last_name', order: 'asc' },
        { column: 'first_name', order: 'asc' },
      ]);
    return rows;
  },
);

export const listTeamsForInboundWebhook = withAuth(
  async (_user, { tenant }): Promise<ITeam[]> => {
    const { knex } = await createTenantKnex(tenant);
    const rows = await knex<{ team_id: string; team_name: string; manager_id: string | null; tenant: string }>('teams')
      .where({ tenant })
      .orderBy('team_name', 'asc');
    return rows.map((row) => ({
      ...row,
      members: [],
    })) as ITeam[];
  },
);
