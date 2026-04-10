'use server';

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
  const searchPattern = `%${query.toLowerCase()}%`;
  const limit = 5;

  const [tickets, clients, contacts, projects, assets, users] = await Promise.all([
    // Tickets: search by ticket_number and title
    knex('tickets')
      .select('ticket_id', 'ticket_number', 'title', 'status_id')
      .where('tenant', user.tenant)
      .andWhere(function () {
        this.whereRaw('LOWER(title) LIKE ?', [searchPattern])
          .orWhereRaw('CAST(ticket_number AS TEXT) LIKE ?', [searchPattern]);
      })
      .orderBy('ticket_number', 'desc')
      .limit(limit)
      .catch(() => []),

    // Clients: search by client_name
    knex('clients')
      .select('client_id', 'client_name')
      .where('tenant', user.tenant)
      .andWhere('is_inactive', false)
      .andWhereRaw('LOWER(client_name) LIKE ?', [searchPattern])
      .orderBy('client_name')
      .limit(limit)
      .catch(() => []),

    // Contacts: search by full_name and email
    knex('contacts')
      .select('contact_name_id', 'full_name', 'email')
      .where('tenant', user.tenant)
      .andWhere(function () {
        this.whereRaw('LOWER(full_name) LIKE ?', [searchPattern])
          .orWhereRaw('LOWER(email) LIKE ?', [searchPattern]);
      })
      .orderBy('full_name')
      .limit(limit)
      .catch(() => []),

    // Projects: search by project_name
    knex('projects')
      .select('project_id', 'project_name', 'status')
      .where('tenant', user.tenant)
      .andWhereRaw('LOWER(project_name) LIKE ?', [searchPattern])
      .orderBy('project_name')
      .limit(limit)
      .catch(() => []),

    // Assets: search by name and asset_tag
    knex('assets')
      .select('asset_id', 'name', 'asset_tag', 'asset_type')
      .where('tenant', user.tenant)
      .andWhere(function () {
        this.whereRaw('LOWER(name) LIKE ?', [searchPattern])
          .orWhereRaw('LOWER(asset_tag) LIKE ?', [searchPattern]);
      })
      .orderBy('name')
      .limit(limit)
      .catch(() => []),

    // Users: search by name, username, email
    knex('users')
      .select('user_id', 'username', 'first_name', 'last_name', 'email')
      .where('tenant', user.tenant)
      .andWhere('user_type', 'internal')
      .andWhere('is_inactive', false)
      .andWhere(function () {
        this.whereRaw('LOWER(username) LIKE ?', [searchPattern])
          .orWhereRaw('LOWER(first_name) LIKE ?', [searchPattern])
          .orWhereRaw('LOWER(last_name) LIKE ?', [searchPattern])
          .orWhereRaw("LOWER(CONCAT(first_name, ' ', last_name)) LIKE ?", [searchPattern]);
      })
      .orderBy('first_name')
      .limit(limit)
      .catch(() => []),
  ]);

  const results: MentionSearchResults = {};

  if (tickets.length > 0) {
    results.ticket = tickets.map((t) => ({
      type: 'ticket' as const,
      id: t.ticket_id,
      displayName: `#${t.ticket_number} - ${t.title}`,
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
