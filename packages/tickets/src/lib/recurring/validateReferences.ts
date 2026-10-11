import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { RecurringTemplateFields } from './effectiveFields';

export interface RecurringReferenceProblem {
  field: 'board_id' | 'status_id' | 'priority_id' | 'category_id' | 'subcategory_id' | 'assigned_to'
    | 'assigned_team_id' | 'additional_agent_ids' | 'contact_id' | 'location_id' | 'asset_ids';
  /** Actionable, user-facing English message (stored as the occurrence `reason` when generating). */
  message: string;
}

export interface RecurringReferenceTargets {
  fields: RecurringTemplateFields;
  /** Client the ticket is for. Contact, location and assets must belong to it. Omit for a definition's own defaults. */
  clientId?: string;
  contactId?: string | null;
  locationId?: string | null;
  assetIds?: readonly string[];
}

/**
 * Checks that everything a recurring ticket will reference still exists and is coherent: the board is
 * active, the status and category belong to that board, assignees are active, and the contact,
 * location and assets belong to the client.
 *
 * One implementation serves two moments: the save-time actions reject on the first problem list, and
 * the generator re-runs it on every occurrence, because those rows can change after a definition is
 * saved (there are deliberately no foreign keys to them). A dangling reference then becomes a
 * `failed` occurrence with the message below rather than a blocked delete.
 */
export async function findRecurringReferenceProblems(
  conn: Knex | Knex.Transaction,
  tenant: string,
  targets: RecurringReferenceTargets
): Promise<RecurringReferenceProblem[]> {
  const db = tenantDb(conn, tenant);
  const { fields } = targets;
  const problems: RecurringReferenceProblem[] = [];

  const board = await db.table('boards').where({ board_id: fields.board_id }).first('board_id', 'board_name', 'is_inactive');
  if (!board) {
    problems.push({ field: 'board_id', message: 'The selected board no longer exists' });
  } else if (board.is_inactive) {
    problems.push({ field: 'board_id', message: `Board ‘${board.board_name}’ is inactive` });
  }

  if (board && fields.status_id) {
    const status = await db
      .table('statuses')
      .where({ status_id: fields.status_id, status_type: 'ticket' })
      .first('status_id', 'board_id', 'name');
    if (!status) {
      problems.push({ field: 'status_id', message: 'The selected status no longer exists' });
    } else if (status.board_id !== fields.board_id) {
      problems.push({ field: 'status_id', message: `Status ‘${status.name}’ does not belong to board ‘${board.board_name}’` });
    }
  }

  const priority = await db
    .table('priorities')
    .where({ priority_id: fields.priority_id, item_type: 'ticket' })
    .first('priority_id');
  if (!priority) problems.push({ field: 'priority_id', message: 'The selected priority no longer exists' });

  if (fields.subcategory_id && !fields.category_id) {
    problems.push({ field: 'subcategory_id', message: 'A subcategory requires a category' });
  }
  if (fields.category_id) {
    const category = await db
      .table('categories')
      .where({ category_id: fields.category_id })
      .first('category_id', 'category_name', 'board_id', 'parent_category');
    if (!category) {
      problems.push({ field: 'category_id', message: 'The selected category no longer exists' });
    } else if (category.board_id && category.board_id !== fields.board_id) {
      problems.push({ field: 'category_id', message: `Category ‘${category.category_name}’ does not belong to the selected board` });
    } else if (category.parent_category) {
      problems.push({ field: 'category_id', message: `Category ‘${category.category_name}’ is a subcategory` });
    }
    if (category && fields.subcategory_id) {
      const sub = await db
        .table('categories')
        .where({ category_id: fields.subcategory_id })
        .first('category_id', 'category_name', 'parent_category');
      if (!sub) {
        problems.push({ field: 'subcategory_id', message: 'The selected subcategory no longer exists' });
      } else if (sub.parent_category !== fields.category_id) {
        problems.push({ field: 'subcategory_id', message: `Subcategory ‘${sub.category_name}’ does not belong to the selected category` });
      }
    }
  }

  const userIds = [...new Set([fields.assigned_to, ...fields.additional_agent_ids].filter((id): id is string => Boolean(id)))];
  if (userIds.length > 0) {
    const users = await db
      .table('users')
      .whereIn('user_id', userIds)
      .select('user_id', 'first_name', 'last_name', 'is_inactive');
    const byId = new Map(users.map((user) => [user.user_id as string, user]));
    const describe = (id: string) => {
      const user = byId.get(id);
      if (!user) return { ok: false, message: 'An assigned user no longer exists' };
      const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || id;
      return user.is_inactive ? { ok: false, message: `Assigned user ${name} is inactive` } : { ok: true, message: '' };
    };
    if (fields.assigned_to) {
      const result = describe(fields.assigned_to);
      if (!result.ok) problems.push({ field: 'assigned_to', message: result.message });
    }
    for (const id of fields.additional_agent_ids) {
      const result = describe(id);
      if (!result.ok) problems.push({ field: 'additional_agent_ids', message: result.message.replace('Assigned user', 'Additional agent') });
    }
  }

  if (fields.assigned_team_id) {
    const team = await db.table('teams').where({ team_id: fields.assigned_team_id }).first('team_id');
    if (!team) problems.push({ field: 'assigned_team_id', message: 'The assigned team no longer exists' });
  }

  if (targets.clientId) {
    if (targets.contactId) {
      const contact = await db
        .table('contacts')
        .where({ contact_name_id: targets.contactId })
        .first('contact_name_id', 'client_id', 'full_name');
      if (!contact) {
        problems.push({ field: 'contact_id', message: 'The selected contact no longer exists' });
      } else if (contact.client_id !== targets.clientId) {
        problems.push({ field: 'contact_id', message: `Contact ${contact.full_name ?? ''} does not belong to this client`.replace('  ', ' ') });
      }
    }
    if (targets.locationId) {
      const location = await db
        .table('client_locations')
        .where({ location_id: targets.locationId })
        .first('location_id', 'client_id', 'location_name');
      if (!location) {
        problems.push({ field: 'location_id', message: 'The selected location no longer exists' });
      } else if (location.client_id !== targets.clientId) {
        problems.push({ field: 'location_id', message: 'The selected location does not belong to this client' });
      }
    }
    const assetIds = [...new Set(targets.assetIds ?? [])];
    if (assetIds.length > 0) {
      const assets = await db
        .table('assets')
        .whereIn('asset_id', assetIds)
        .where({ client_id: targets.clientId })
        .select('asset_id');
      if (assets.length !== assetIds.length) {
        problems.push({ field: 'asset_ids', message: 'One or more linked assets no longer exist for this client' });
      }
    }
  }

  return problems;
}
