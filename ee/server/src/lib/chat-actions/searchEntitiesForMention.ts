'use server';

import type { Knex } from 'knex';
import { createTenantKnex } from '@/lib/db';
import { getCurrentUser } from '@alga-psa/user-composition/actions';

export type MentionableEntityType =
  | 'ticket'
  | 'client'
  | 'contact'
  | 'project'
  | 'asset'
  | 'user';

export type MentionableEntity = {
  type: MentionableEntityType;
  id: string;
  displayName: string;
  /**
   * Core name used for auto-select equality / prefix checks. Defaults to
   * displayName if omitted. For entities whose displayName is decorated
   * (e.g., "#TIC001 - title", "Name (tag)"), this should be the bare name
   * the user is most likely to type verbatim.
   */
  matchName?: string;
  secondaryText?: string;
};

export type MentionSearchResults = {
  [K in MentionableEntityType]?: MentionableEntity[];
};

export async function searchEntitiesForMention(
  query: string,
): Promise<MentionSearchResults> {
  const user = await getCurrentUser();
  if (!user?.tenant) {
    return {};
  }

  const { knex } = await createTenantKnex();
  const limit = 5;

  // Split the query into words so that "Acme Corp" still matches rows named
  // "Acme" plus additional words — each word becomes a separate substring
  // condition, all ANDed together. Empty queries (user just typed "@") fall
  // back to a single "%"-only pattern that matches anything.
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0)
    .slice(0, 10);
  const patterns = words.length > 0 ? words.map((w) => `%${w}%`) : ['%'];

  // Applies `fields LIKE pattern` for every word (ANDed) against the OR of
  // all provided raw field expressions (each containing a `?` placeholder).
  const applyWordFilters = (
    qb: Knex.QueryBuilder,
    fieldExpressions: string[],
  ) => {
    for (const pattern of patterns) {
      qb.andWhere(function () {
        for (let i = 0; i < fieldExpressions.length; i += 1) {
          if (i === 0) {
            this.whereRaw(fieldExpressions[i], [pattern]);
          } else {
            this.orWhereRaw(fieldExpressions[i], [pattern]);
          }
        }
      });
    }
  };

  const [tickets, clients, contacts, projects, assets, users] = await Promise.all([
    // Tickets: search by ticket_number and title
    (() => {
      const qb = knex('tickets')
        .select('ticket_id', 'ticket_number', 'title', 'status_id')
        .where('tenant', user.tenant);
      applyWordFilters(qb, [
        'LOWER(title) LIKE ?',
        'CAST(ticket_number AS TEXT) LIKE ?',
      ]);
      return qb.orderBy('ticket_number', 'desc').limit(limit).catch(() => []);
    })(),

    // Clients: search by client_name
    (() => {
      const qb = knex('clients')
        .select('client_id', 'client_name')
        .where('tenant', user.tenant)
        .andWhere('is_inactive', false);
      applyWordFilters(qb, ['LOWER(client_name) LIKE ?']);
      return qb.orderBy('client_name').limit(limit).catch(() => []);
    })(),

    // Contacts: search by full_name and email
    (() => {
      const qb = knex('contacts')
        .select('contact_name_id', 'full_name', 'email')
        .where('tenant', user.tenant);
      applyWordFilters(qb, [
        'LOWER(full_name) LIKE ?',
        'LOWER(email) LIKE ?',
      ]);
      return qb.orderBy('full_name').limit(limit).catch(() => []);
    })(),

    // Projects: search by project_name
    (() => {
      const qb = knex('projects')
        .select('project_id', 'project_name', 'status')
        .where('tenant', user.tenant);
      applyWordFilters(qb, ['LOWER(project_name) LIKE ?']);
      return qb.orderBy('project_name').limit(limit).catch(() => []);
    })(),

    // Assets: search by name and asset_tag
    (() => {
      const qb = knex('assets')
        .select('asset_id', 'name', 'asset_tag', 'asset_type')
        .where('tenant', user.tenant);
      applyWordFilters(qb, [
        'LOWER(name) LIKE ?',
        'LOWER(asset_tag) LIKE ?',
      ]);
      return qb.orderBy('name').limit(limit).catch(() => []);
    })(),

    // Users: search by name, username, email
    (() => {
      const qb = knex('users')
        .select('user_id', 'username', 'first_name', 'last_name', 'email')
        .where('tenant', user.tenant)
        .andWhere('user_type', 'internal')
        .andWhere('is_inactive', false);
      applyWordFilters(qb, [
        'LOWER(username) LIKE ?',
        'LOWER(first_name) LIKE ?',
        'LOWER(last_name) LIKE ?',
        "LOWER(CONCAT(first_name, ' ', last_name)) LIKE ?",
      ]);
      return qb.orderBy('first_name').limit(limit).catch(() => []);
    })(),
  ]);

  const results: MentionSearchResults = {};

  if (tickets.length > 0) {
    results.ticket = tickets.map((t) => ({
      type: 'ticket' as const,
      id: t.ticket_id,
      displayName: `#${t.ticket_number} - ${t.title}`,
      matchName: t.title,
    }));
  }

  if (clients.length > 0) {
    results.client = clients.map((c) => ({
      type: 'client' as const,
      id: c.client_id,
      displayName: c.client_name,
    }));
  }

  if (contacts.length > 0) {
    results.contact = contacts.map((c) => ({
      type: 'contact' as const,
      id: c.contact_name_id,
      displayName: c.full_name,
      secondaryText: c.email || undefined,
    }));
  }

  if (projects.length > 0) {
    results.project = projects.map((p) => ({
      type: 'project' as const,
      id: p.project_id,
      displayName: p.project_name,
      secondaryText: p.status || undefined,
    }));
  }

  if (assets.length > 0) {
    results.asset = assets.map((a) => ({
      type: 'asset' as const,
      id: a.asset_id,
      displayName: a.asset_tag ? `${a.name} (${a.asset_tag})` : a.name,
      matchName: a.name,
      secondaryText: a.asset_type || undefined,
    }));
  }

  if (users.length > 0) {
    results.user = users.map((u) => {
      const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
      return {
        type: 'user' as const,
        id: u.user_id,
        displayName: fullName || u.username || u.email,
        secondaryText: u.email || undefined,
      };
    });
  }

  return results;
}
