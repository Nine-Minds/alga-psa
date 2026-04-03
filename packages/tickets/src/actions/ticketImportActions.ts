'use server';

import { Knex } from 'knex';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { unparseCSV } from '@alga-psa/core';
import { createTagsForEntityWithTransaction } from '@alga-psa/tags/actions';
import { TicketModel, CreateTicketInput } from '@alga-psa/shared/models/ticketModel';
import {
  MappableTicketField,
  ITicketImportReferenceData,
  ITicketImportResult,
  IProcessedTicketData,
  IClientResolution,
  ITicketStatusResolution,
  IPriorityResolution,
  ICategoryResolution,
} from '@alga-psa/types';

// ---------------------------------------------------------------------------
// CSV template
// ---------------------------------------------------------------------------

export async function generateTicketCSVTemplate(): Promise<string> {
  const templateData = [
    {
      title: 'Network connectivity issue',
      description: 'Client reports intermittent connectivity drops in office',
      status: 'Open',
      priority: 'High',
      category: 'Network',
      client: 'Acme Corp',
      contact: 'John Smith',
      assigned_to: 'Jane Doe',
      assigned_team: 'Tier 2 Support',
      due_date: '2024-03-15',
      entered_at: '2024-03-01',
      closed_at: '',
      is_closed: 'No',
      tags: 'network,urgent',
    },
    {
      title: 'Email not syncing',
      description: 'Outlook not syncing with Exchange server',
      status: 'In Progress',
      priority: 'Medium',
      category: 'Email',
      client: 'Globex Industries',
      contact: 'Bob Johnson',
      assigned_to: 'Mike Wilson',
      assigned_team: '',
      due_date: '2024-03-10',
      entered_at: '2024-02-28',
      closed_at: '',
      is_closed: 'No',
      tags: 'email,exchange',
    },
    {
      title: 'Printer driver installation',
      description: 'Install new printer drivers on 5 workstations',
      status: 'Closed',
      priority: 'Low',
      category: 'Hardware',
      client: 'Acme Corp',
      contact: 'Sarah Lee',
      assigned_to: 'Jane Doe',
      assigned_team: 'Tier 1 Support',
      due_date: '2024-02-20',
      entered_at: '2024-02-15',
      closed_at: '2024-02-19',
      is_closed: 'Yes',
      tags: 'hardware',
    },
    {
      title: 'VPN access request',
      description: 'New employee needs VPN access configured',
      status: 'Open',
      priority: 'Medium',
      category: 'Security',
      client: 'Initech',
      contact: 'Peter Gibbons',
      assigned_to: '',
      assigned_team: '',
      due_date: '',
      entered_at: '2024-03-05',
      closed_at: '',
      is_closed: 'No',
      tags: 'vpn,onboarding',
    },
  ];

  const fields: MappableTicketField[] = [
    'title',
    'description',
    'status',
    'priority',
    'category',
    'client',
    'contact',
    'assigned_to',
    'assigned_team',
    'due_date',
    'entered_at',
    'closed_at',
    'is_closed',
    'tags',
  ];

  return unparseCSV(templateData, fields);
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export const getTicketImportReferenceData = withAuth(async (
  _user,
  { tenant },
  defaultBoardId?: string
): Promise<ITicketImportReferenceData> => {
  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    const [boards, users, teams, priorities, clients, contacts, allStatuses, allCategories] = await Promise.all([
      // Active boards
      trx('boards')
        .select('board_id', 'board_name', 'is_default')
        .where('tenant', tenant)
        .where('is_inactive', false)
        .orderBy('board_name'),

      // Active internal users
      trx('users')
        .select('user_id', 'username', 'first_name', 'last_name', 'email', 'user_type', 'is_inactive', 'tenant')
        .where('tenant', tenant)
        .where('is_inactive', false)
        .where('user_type', 'internal')
        .orderBy(['first_name', 'last_name']),

      // Teams
      trx('teams')
        .select('team_id', 'team_name')
        .where('tenant', tenant)
        .orderBy('team_name'),

      // Ticket priorities
      trx('priorities')
        .select('priority_id', 'priority_name')
        .where('tenant', tenant)
        .where('item_type', 'ticket')
        .orderBy('order_number'),

      // Active clients
      trx('clients')
        .select('client_id', 'client_name')
        .where('tenant', tenant)
        .where('is_inactive', false)
        .orderBy('client_name'),

      // Active contacts
      trx('contacts')
        .select('contact_name_id', 'full_name', 'email', 'client_id')
        .where('tenant', tenant)
        .where('is_inactive', false)
        .orderBy('full_name'),

      // All ticket statuses (with board_id)
      trx('statuses')
        .select('status_id', 'name', 'board_id', 'is_default', 'is_closed')
        .where('tenant', tenant)
        .where('status_type', 'ticket')
        .orderBy('order_number'),

      // All ticket categories (with board_id)
      trx('categories')
        .select('category_id', 'category_name', 'board_id', 'parent_category')
        .where('tenant', tenant)
        .orderBy('category_name'),
    ]);

    // Build lookup maps
    const boardLookup: Record<string, string> = {};
    boards.forEach((b: { board_id: string; board_name: string }) => {
      boardLookup[b.board_name.toLowerCase().trim()] = b.board_id;
    });

    const userLookup: Record<string, string> = {};
    users.forEach((u: { user_id: string; first_name: string; last_name: string; username: string; email: string }) => {
      const fullName = `${u.first_name} ${u.last_name}`.toLowerCase().trim();
      if (fullName) userLookup[fullName] = u.user_id;
      if (u.username) userLookup[u.username.toLowerCase().trim()] = u.user_id;
      if (u.email) userLookup[u.email.toLowerCase().trim()] = u.user_id;
    });

    const teamLookup: Record<string, string> = {};
    teams.forEach((t: { team_id: string; team_name: string }) => {
      teamLookup[t.team_name.toLowerCase().trim()] = t.team_id;
    });

    const priorityLookup: Record<string, string> = {};
    priorities.forEach((p: { priority_id: string; priority_name: string }) => {
      priorityLookup[p.priority_name.toLowerCase().trim()] = p.priority_id;
    });

    const clientLookup: Record<string, string> = {};
    clients.forEach((c: { client_id: string; client_name: string }) => {
      clientLookup[c.client_name.toLowerCase().trim()] = c.client_id;
    });

    const contactLookup: Record<string, string> = {};
    contacts.forEach((c: { contact_name_id: string; full_name: string; email: string | null }) => {
      if (c.full_name) contactLookup[c.full_name.toLowerCase().trim()] = c.contact_name_id;
      if (c.email) contactLookup[c.email.toLowerCase().trim()] = c.contact_name_id;
    });

    // Group statuses by board
    const statusesByBoard: ITicketImportReferenceData['statusesByBoard'] = {};
    allStatuses.forEach((s: { status_id: string; name: string; board_id: string | null; is_default: boolean; is_closed: boolean }) => {
      const boardId = s.board_id || '_global';
      if (!statusesByBoard[boardId]) statusesByBoard[boardId] = [];
      statusesByBoard[boardId].push({
        status_id: s.status_id,
        name: s.name,
        is_default: Boolean(s.is_default),
        is_closed: Boolean(s.is_closed),
      });
    });

    // Build status lookup by board
    const statusLookupByBoard: Record<string, Record<string, string>> = {};
    for (const [boardId, statuses] of Object.entries(statusesByBoard)) {
      statusLookupByBoard[boardId] = {};
      statuses.forEach(s => {
        statusLookupByBoard[boardId][s.name.toLowerCase().trim()] = s.status_id;
      });
    }

    // Group categories by board
    const categoriesByBoard: ITicketImportReferenceData['categoriesByBoard'] = {};
    allCategories.forEach((c: { category_id: string; category_name: string; board_id: string | null; parent_category: string | null }) => {
      const boardId = c.board_id || '_global';
      if (!categoriesByBoard[boardId]) categoriesByBoard[boardId] = [];
      categoriesByBoard[boardId].push({
        category_id: c.category_id,
        category_name: c.category_name,
        parent_category: c.parent_category,
      });
    });

    // Build category lookup by board
    const categoryLookupByBoard: Record<string, Record<string, string>> = {};
    for (const [boardId, categories] of Object.entries(categoriesByBoard)) {
      categoryLookupByBoard[boardId] = {};
      categories.forEach(c => {
        categoryLookupByBoard[boardId][c.category_name.toLowerCase().trim()] = c.category_id;
      });
    }

    return {
      boards,
      users,
      teams,
      priorities,
      clients,
      contacts,
      statusesByBoard,
      categoriesByBoard,
      boardLookup,
      userLookup,
      teamLookup,
      priorityLookup,
      clientLookup,
      contactLookup,
      statusLookupByBoard,
      categoryLookupByBoard,
    };
  });
});

// ---------------------------------------------------------------------------
// Import execution
// ---------------------------------------------------------------------------

export const importTickets = withAuth(async (
  user,
  { tenant },
  processedTickets: IProcessedTicketData[],
  statusResolutions: ITicketStatusResolution[],
  clientResolutions: IClientResolution[],
  priorityResolutions: IPriorityResolution[],
  categoryResolutions: ICategoryResolution[],
  defaultBoardId: string
): Promise<ITicketImportResult> => {
  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    if (!await hasPermission(user, 'ticket', 'create')) {
      throw new Error('Permission denied: Cannot create tickets');
    }

    let ticketsCreated = 0;
    let ticketsSkipped = 0;
    const errors: string[] = [];

    // Helper: run an insert inside a savepoint so a failure doesn't poison the transaction
    async function safeInsert<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
      const sp = `sp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await trx.raw(`SAVEPOINT ${sp}`);
      try {
        const result = await fn();
        await trx.raw(`RELEASE SAVEPOINT ${sp}`);
        return result;
      } catch (err) {
        await trx.raw(`ROLLBACK TO SAVEPOINT ${sp}`);
        const msg = err instanceof Error ? err.message : 'Unknown error';
        errors.push(`${label}: ${msg}`);
        return null;
      }
    }

    // Step 1: Create new clients from resolutions
    const createdClientMap = new Map<string, string>();
    for (const resolution of clientResolutions) {
      if (resolution.action === 'create') {
        const result = await safeInsert(`Failed to create client "${resolution.originalClientName}"`, async () => {
          const [newClient] = await trx('clients')
            .insert({
              client_id: trx.raw('gen_random_uuid()'),
              tenant,
              client_name: resolution.originalClientName,
              client_type: 'company',
              is_inactive: false,
              created_at: new Date(),
              updated_at: new Date(),
            })
            .returning(['client_id']);
          return newClient;
        });
        if (result) createdClientMap.set(resolution.originalClientName.toLowerCase().trim(), result.client_id);
      }
    }

    // Step 2: Create new statuses from resolutions
    const createdStatusMap = new Map<string, string>();
    for (const resolution of statusResolutions) {
      if (resolution.action === 'create') {
        const result = await safeInsert(`Failed to create status "${resolution.originalStatusName}"`, async () => {
          const maxOrder = await trx('statuses')
            .where({ tenant, board_id: resolution.boardId, status_type: 'ticket' })
            .max('order_number as max')
            .first();
          const nextOrder = ((maxOrder?.max as number) || 0) + 1;

          const [newStatus] = await trx('statuses')
            .insert({
              status_id: trx.raw('gen_random_uuid()'),
              tenant,
              name: resolution.originalStatusName,
              status_type: 'ticket',
              board_id: resolution.boardId,
              order_number: nextOrder,
              is_closed: false,
              is_default: false,
              created_by: user.user_id,
              created_at: new Date(),
            })
            .returning(['status_id']);
          return newStatus;
        });
        if (result) createdStatusMap.set(resolution.originalStatusName.toLowerCase().trim(), result.status_id);
      }
    }

    // Step 3: Create new priorities from resolutions
    const createdPriorityMap = new Map<string, string>();
    for (const resolution of priorityResolutions) {
      if (resolution.action === 'create') {
        const result = await safeInsert(`Failed to create priority "${resolution.originalPriorityName}"`, async () => {
          const maxOrder = await trx('priorities')
            .where({ tenant, item_type: 'ticket' })
            .max('order_number as max')
            .first();
          const nextOrder = ((maxOrder?.max as number) || 0) + 1;

          const [newPriority] = await trx('priorities')
            .insert({
              priority_id: trx.raw('gen_random_uuid()'),
              tenant,
              priority_name: resolution.originalPriorityName,
              item_type: 'ticket',
              order_number: nextOrder,
              color: '#6B7280',
              created_by: user.user_id,
              created_at: new Date(),
            })
            .returning(['priority_id']);
          return newPriority;
        });
        if (result) createdPriorityMap.set(resolution.originalPriorityName.toLowerCase().trim(), result.priority_id);
      }
    }

    // Step 4: Create new categories from resolutions
    const createdCategoryMap = new Map<string, string>();
    for (const resolution of categoryResolutions) {
      if (resolution.action === 'create') {
        const result = await safeInsert(`Failed to create category "${resolution.originalCategoryName}"`, async () => {
          const [newCategory] = await trx('categories')
            .insert({
              category_id: trx.raw('gen_random_uuid()'),
              tenant,
              category_name: resolution.originalCategoryName,
              board_id: resolution.boardId,
              parent_category: null,
              created_by: user.user_id,
              created_at: new Date(),
            })
            .returning(['category_id']);
          return newCategory;
        });
        if (result) createdCategoryMap.set(resolution.originalCategoryName.toLowerCase().trim(), result.category_id);
      }
    }

    // Step 5: Get default status and priority for fallbacks
    const defaultStatusRow = await trx('statuses')
      .where({ tenant, board_id: defaultBoardId, status_type: 'ticket', is_default: true })
      .first();
    const fallbackStatusId = defaultStatusRow?.status_id;

    // If no default status, get the first one
    const firstStatusRow = !fallbackStatusId
      ? await trx('statuses')
          .where({ tenant, board_id: defaultBoardId, status_type: 'ticket' })
          .orderBy('order_number')
          .first()
      : null;
    const resolvedFallbackStatusId = fallbackStatusId || firstStatusRow?.status_id;

    if (!resolvedFallbackStatusId) {
      throw new Error('No ticket statuses found for the selected board. Please configure statuses first.');
    }

    // Get first priority as fallback
    const firstPriority = await trx('priorities')
      .where({ tenant, item_type: 'ticket' })
      .orderBy('order_number')
      .first();
    const fallbackPriorityId = firstPriority?.priority_id;

    if (!fallbackPriorityId) {
      throw new Error('No ticket priorities found. Please configure priorities first.');
    }

    // Step 6: Create tickets
    for (const ticket of processedTickets) {
      if (!ticket.title) {
        ticketsSkipped++;
        errors.push(`Row ${ticket.rowNumber}: Skipped — title is missing`);
        continue;
      }

      // Resolve client_id from creation placeholders
      let resolvedClientId = ticket.client_id;
      if (resolvedClientId?.startsWith('__create__:')) {
        const clientName = resolvedClientId.replace('__create__:', '');
        resolvedClientId = createdClientMap.get(clientName.toLowerCase().trim()) || null;
      }

      if (!resolvedClientId) {
        ticketsSkipped++;
        errors.push(`Row ${ticket.rowNumber}: Skipped — client could not be resolved`);
        continue;
      }

      // Resolve all __create__ placeholders to actual IDs
      let resolvedStatusId = ticket.status_id;
      if (resolvedStatusId?.startsWith('__create__:')) {
        resolvedStatusId = createdStatusMap.get(resolvedStatusId.replace('__create__:', '').toLowerCase().trim()) || null;
      }
      let resolvedPriorityId = ticket.priority_id;
      if (resolvedPriorityId?.startsWith('__create__:')) {
        resolvedPriorityId = createdPriorityMap.get(resolvedPriorityId.replace('__create__:', '').toLowerCase().trim()) || null;
      }
      let resolvedCategoryId = ticket.category_id;
      if (resolvedCategoryId?.startsWith('__create__:')) {
        resolvedCategoryId = createdCategoryMap.get(resolvedCategoryId.replace('__create__:', '').toLowerCase().trim()) || null;
      }
      let resolvedSubcategoryId = ticket.subcategory_id;
      if (resolvedSubcategoryId?.startsWith('__create_sub__:')) {
        resolvedSubcategoryId = createdCategoryMap.get(resolvedSubcategoryId.replace('__create_sub__:', '').toLowerCase().trim()) || null;
      }

      // Use a savepoint so one ticket failure doesn't abort the rest
      const created = await safeInsert(`Row ${ticket.rowNumber}: Failed to create ticket "${ticket.title}"`, async () => {
        // Determine if ticket should be closed based on status
        let isClosed = ticket.is_closed;
        if (resolvedStatusId) {
          const statusRow = await trx('statuses')
            .where({ status_id: resolvedStatusId, tenant })
            .select('is_closed')
            .first();
          if (statusRow?.is_closed) isClosed = true;
        }

        const createInput: CreateTicketInput = {
          title: ticket.title,
          description: ticket.description || undefined,
          client_id: resolvedClientId!,
          contact_id: ticket.contact_id || undefined,
          status_id: resolvedStatusId || resolvedFallbackStatusId,
          priority_id: resolvedPriorityId || fallbackPriorityId,
          board_id: ticket.board_id,
          category_id: resolvedCategoryId || undefined,
          subcategory_id: resolvedSubcategoryId || undefined,
          assigned_to: ticket.assigned_to || undefined,
          assigned_team_id: ticket.assigned_team_id || undefined,
          due_date: ticket.due_date || undefined,
          entered_by: user.user_id,
          source: 'csv_import',
          ticket_origin: 'INTERNAL',
        };

        const result = await TicketModel.createTicket(
          createInput,
          tenant,
          trx,
          { skipLocationValidation: true, skipCategoryValidation: true, skipSubcategoryValidation: true, skipStatusBoardValidation: true },
          undefined,
          undefined,
          user.user_id
        );

        if (isClosed && result.ticket_id) {
          await trx('tickets').where({ ticket_id: result.ticket_id, tenant }).update({
            closed_at: ticket.closed_at || new Date().toISOString(),
            closed_by: user.user_id,
          });
        }

        if (ticket.entered_at && result.ticket_id) {
          await trx('tickets').where({ ticket_id: result.ticket_id, tenant }).update({ entered_at: ticket.entered_at });
        }

        if (ticket.tags.length > 0 && result.ticket_id) {
          const pendingTags = ticket.tags.map(tagText => ({
            tag_text: tagText, background_color: null, text_color: null, isNew: true,
          }));
          await createTagsForEntityWithTransaction(trx, tenant, result.ticket_id, 'ticket', pendingTags);
        }

        return result;
      });

      if (created) {
        ticketsCreated++;
      } else {
        ticketsSkipped++;
      }
    }

    return {
      success: errors.length === 0,
      ticketsCreated,
      ticketsSkipped,
      errors,
    };
  });
});
