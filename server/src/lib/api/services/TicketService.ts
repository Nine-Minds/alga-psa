/**
 * Ticket Service
 * Business logic for ticket-related operations
 */

import { Knex } from 'knex';
import { BaseService, ServiceContext, ListResult } from '@alga-psa/db';
import { ITicket, ITicketWithDetails } from 'server/src/interfaces/ticket.interfaces';
import { IDocument } from 'server/src/interfaces/document.interface';
import { ITicketMaterial } from 'server/src/interfaces/material.interfaces';
import { TICKET_ORIGINS } from '@alga-psa/types';
import { withTransaction } from '@alga-psa/db';
import { maybeReopenBundleMasterFromChildReply } from '@alga-psa/tickets/actions/ticketBundleUtils';
import { deleteTicketChildRecords } from '@alga-psa/tickets/lib/deleteTicketChildRecords';
import { enforceTicketCloseRules, TicketCloseValidationError } from '@alga-psa/tickets/lib/validateTicketClosure';
import { deleteEntityWithValidation } from '@alga-psa/core';
import { publishWorkflowEvent } from 'server/src/lib/eventBus/publishers';
import { NotFoundError, ValidationError, ConflictError } from '../middleware/apiMiddleware';
import { TicketModel, CreateTicketInput } from '@shared/models/ticketModel';
import {
  TICKET_ACTIVITY_ACTOR,
  TICKET_ACTIVITY_ENTITY,
  TICKET_ACTIVITY_EVENT,
  TICKET_ACTIVITY_SOURCE,
  buildCuratedTicketDiffWithLabels,
  hasCuratedChanges,
  writeTicketActivity,
} from '@alga-psa/shared/lib/ticketActivity';
import { ServerAnalyticsTracker } from '@alga-psa/analytics';
// Event types no longer needed as we create objects directly
import {
  CreateTicketData,
  UpdateTicketData,
  TicketFilterData,
  CreateTicketCommentData,
  CreateTicketMaterialData,
  UpdateTicketCommentData,
  TicketSearchData,
  CreateTicketFromAssetData
} from '../schemas/ticket';
import { ListOptions } from '../controllers/types';
import { analytics } from '../../analytics/posthog';
import { AnalyticsEvents } from '../../analytics/events';
import { renderTicketDescriptionHtml, renderTicketRichTextHtml } from './ticketRichRender';
import { getClientLogoUrl, getContactAvatarUrl, getUserAvatarUrl } from '@alga-psa/formatting/avatarUtils';
import { aggregateReactions } from '@alga-psa/types';
import { StorageService } from '@alga-psa/storage/StorageService';
import { v4 as uuidv4 } from 'uuid';
// import { performanceTracker } from '../../analytics/performanceTracking';

const TICKET_MOBILE_LIST_FIELDS = [
  'ticket_id',
  'ticket_number',
  'title',
  'status_id',
  'status_name',
  'status_is_closed',
  'priority_name',
  'assigned_to_name',
  'client_name',
  'contact_name',
  'updated_at',
  'entered_at',
  'closed_at',
  'tags',
];

const TICKET_LIST_FIELD_ALLOWLIST = new Set<string>([
  ...TICKET_MOBILE_LIST_FIELDS,
  'mobile_list',
]);

function applyDefaultContactPhoneJoin(
  query: Knex.QueryBuilder,
  knex: Knex,
  ticketAlias = 't',
  contactAlias = 'cont',
  phoneAlias = 'cpn_default'
): Knex.QueryBuilder {
  return query
    .leftJoin(`contacts as ${contactAlias}`, function joinContacts() {
      this.on(`${ticketAlias}.contact_name_id`, '=', `${contactAlias}.contact_name_id`)
        .andOn(`${ticketAlias}.tenant`, '=', `${contactAlias}.tenant`);
    })
    .leftJoin(`contact_phone_numbers as ${phoneAlias}`, function joinDefaultContactPhone() {
      this.on(`${contactAlias}.contact_name_id`, '=', `${phoneAlias}.contact_name_id`)
        .andOn(`${contactAlias}.tenant`, '=', `${phoneAlias}.tenant`)
        .andOn(`${phoneAlias}.is_default`, '=', knex.raw('true'));
    });
}

export type BundleMode = 'link_only' | 'sync_updates';

export interface BundleMemberTicket {
  ticket_id: string;
  ticket_number: string | null;
  title: string | null;
  status_id: string | null;
  client_id: string | null;
}

export interface BundleView {
  role: 'master' | 'child' | 'standalone';
  master_ticket_id: string;
  master: BundleMemberTicket | null;
  children: BundleMemberTicket[];
  settings: { mode: BundleMode; reopen_on_child_reply: boolean } | null;
}

export class TicketService extends BaseService<ITicket> {
  constructor() {
    super({
      tableName: 'tickets',
      primaryKey: 'ticket_id',
      tenantColumn: 'tenant',
      searchableFields: ['title', 'ticket_number'],
      defaultSort: 'entered_at',
      defaultOrder: 'desc'
    });
  }

  /**
   * Delete a ticket and all of its dependent rows.
   *
   * BaseService.delete() issues a bare `DELETE FROM tickets`, which both trips
   * the foreign keys on child tables (CitusDB has no ON DELETE CASCADE) and
   * would let the API force-delete a ticket that still has blocking records
   * such as time entries. We override it to run the same dependency validation
   * and child-row cleanup as the MSP server-action delete path: deletion is
   * refused (409) when blocking dependencies exist, otherwise the dependent
   * rows are cleaned up before the ticket is removed.
   */
  async delete(id: string, context: ServiceContext): Promise<void> {
    const { knex } = await this.getKnex();

    const result = await deleteEntityWithValidation(
      'ticket',
      id,
      knex,
      context.tenant,
      async (trx, tenant) => {
        const ticket = await trx('tickets')
          .where({ ticket_id: id, tenant })
          .first();

        if (!ticket) {
          throw new NotFoundError('Ticket not found');
        }

        await deleteTicketChildRecords(trx, id, tenant, ticket);

        await trx('tickets')
          .where({ ticket_id: id, tenant })
          .delete();
      }
    );

    if (!result.deleted) {
      throw new ConflictError(
        result.message || 'Ticket cannot be deleted while dependent records exist',
        {
          code: result.code,
          dependencies: result.dependencies,
          alternatives: result.alternatives,
        }
      );
    }

    // Mirror the MSP server-action delete path: notify downstream consumers
    // (e.g. the search indexer removes the ticket from the index) once the
    // delete has committed. Publishing is best-effort and never fails the request.
    await this.safePublishEvent('TICKET_DELETED', context, {
      ticketId: id,
      userId: context.userId,
    });
  }

  /**
   * List tickets with enhanced filtering and related data
   */
  async list(options: ListOptions, context: ServiceContext): Promise<ListResult<ITicket>> {
    const { knex } = await this.getKnex();
    
    const {
      page = 1,
      limit = 25,
      filters = {} as TicketFilterData,
      sort,
      order,
      fields
    } = options;

    const selectedFields = this.normalizeTicketListFields(fields);

    // Build base query with all necessary joins
    let dataQuery = knex('tickets as t').where('t.tenant', context.tenant);

    let countQuery = knex('tickets as t')
      .where('t.tenant', context.tenant);

    // Apply filters
    dataQuery = this.applyTicketFilters(dataQuery, filters);
    countQuery = this.applyTicketFilters(countQuery, filters);

    // Push row-level read authorization into SQL (when the caller provides it)
    // so both the page and the total count reflect only authorized rows.
    if (options.applyAuthorization) {
      options.applyAuthorization(dataQuery);
      options.applyAuthorization(countQuery);
    }

    // Apply sorting
    const sortField = sort || this.defaultSort;
    const sortOrder = order || this.defaultOrder;
    // Map created_at to entered_at for tickets table
    const mappedSortField = sortField === 'created_at' ? 'entered_at' : sortField;

    const wants = (field: string) => Boolean(selectedFields && selectedFields.includes(field));

    const needsClients = !selectedFields || wants('client_name') || mappedSortField === 'client_name';
    const needsContacts = !selectedFields || wants('contact_name');
    const needsStatuses = !selectedFields || wants('status_name') || wants('status_is_closed') || mappedSortField === 'status_name';
    const needsPriorities = !selectedFields || wants('priority_name') || mappedSortField === 'priority_name';
    const needsAssignedUser = !selectedFields || wants('assigned_to_name');

    if (needsClients) {
      dataQuery = dataQuery.leftJoin('clients as comp', function () {
        this.on('t.client_id', '=', 'comp.client_id').andOn('t.tenant', '=', 'comp.tenant');
      });
    }

    if (needsContacts) {
      dataQuery = dataQuery.leftJoin('contacts as cont', function () {
        this.on('t.contact_name_id', '=', 'cont.contact_name_id').andOn('t.tenant', '=', 'cont.tenant');
      });
    }

    if (needsStatuses) {
      dataQuery = dataQuery.leftJoin('statuses as stat', function () {
        this.on('t.status_id', '=', 'stat.status_id').andOn('t.tenant', '=', 'stat.tenant');
      });
    }

    if (needsPriorities) {
      dataQuery = dataQuery.leftJoin('priorities as pri', function () {
        this.on('t.priority_id', '=', 'pri.priority_id').andOn('t.tenant', '=', 'pri.tenant');
      });
    }

    if (needsAssignedUser) {
      dataQuery = dataQuery.leftJoin('users as assigned_user', function () {
        this.on('t.assigned_to', '=', 'assigned_user.user_id').andOn('t.tenant', '=', 'assigned_user.tenant');
      });
    }

    // Handle sorting by related fields
    if (mappedSortField === 'client_name') {
      dataQuery = dataQuery.orderBy('comp.client_name', sortOrder);
    } else if (mappedSortField === 'status_name') {
      dataQuery = dataQuery.orderBy('stat.name', sortOrder);
    } else if (mappedSortField === 'priority_name') {
      dataQuery = dataQuery.orderBy('pri.priority_name', sortOrder);
    } else {
      dataQuery = dataQuery.orderBy(`t.${mappedSortField}`, sortOrder);
    }

    // Apply pagination
    const offset = (page - 1) * limit;
    dataQuery = dataQuery.limit(limit).offset(offset);

    // Select fields
    if (!selectedFields) {
      // Full payload (backward-compatible default)
      dataQuery = dataQuery
        .leftJoin('categories as cat', function () {
          this.on('t.category_id', '=', 'cat.category_id').andOn('t.tenant', '=', 'cat.tenant');
        })
        .leftJoin('categories as subcat', function () {
          this.on('t.subcategory_id', '=', 'subcat.category_id').andOn('t.tenant', '=', 'subcat.tenant');
        })
        .leftJoin('boards as board', function () {
          this.on('t.board_id', '=', 'board.board_id').andOn('t.tenant', '=', 'board.tenant');
        })
        .leftJoin('users as entered_user', function () {
          this.on('t.entered_by', '=', 'entered_user.user_id').andOn('t.tenant', '=', 'entered_user.tenant');
        })
        .select(
          't.*',
          'comp.client_name',
          'cont.full_name as contact_name',
          'stat.name as status_name',
          'stat.is_closed as status_is_closed',
          'pri.priority_name',
          'cat.category_name',
          'subcat.category_name as subcategory_name',
          'board.board_name as board_name',
          knex.raw(`CASE 
            WHEN entered_user.first_name IS NOT NULL AND entered_user.last_name IS NOT NULL 
            THEN CONCAT(entered_user.first_name, ' ', entered_user.last_name) 
            ELSE NULL 
          END as entered_by_name`),
          knex.raw(`CASE 
            WHEN assigned_user.first_name IS NOT NULL AND assigned_user.last_name IS NOT NULL 
            THEN CONCAT(assigned_user.first_name, ' ', assigned_user.last_name) 
            ELSE NULL 
          END as assigned_to_name`),
        );
    } else {
      const selectParts: any[] = [];

      if (selectedFields.includes('ticket_id')) selectParts.push('t.ticket_id');
      if (selectedFields.includes('ticket_number')) selectParts.push('t.ticket_number');
      if (selectedFields.includes('title')) selectParts.push('t.title');
      if (selectedFields.includes('status_id')) selectParts.push('t.status_id');
      if (selectedFields.includes('client_name')) selectParts.push('comp.client_name');
      if (selectedFields.includes('contact_name')) selectParts.push('cont.full_name as contact_name');
      if (selectedFields.includes('status_name')) selectParts.push('stat.name as status_name');
      if (selectedFields.includes('status_is_closed')) selectParts.push('stat.is_closed as status_is_closed');
      if (selectedFields.includes('priority_name')) selectParts.push('pri.priority_name');
      if (selectedFields.includes('updated_at')) selectParts.push('t.updated_at');
      if (selectedFields.includes('entered_at')) selectParts.push('t.entered_at');
      if (selectedFields.includes('closed_at')) selectParts.push('t.closed_at');

      if (selectedFields.includes('assigned_to_name')) {
        selectParts.push(
          knex.raw(`CASE
            WHEN assigned_user.first_name IS NOT NULL AND assigned_user.last_name IS NOT NULL
            THEN CONCAT(assigned_user.first_name, ' ', assigned_user.last_name)
            ELSE NULL
          END as assigned_to_name`),
        );
      }

      // Authorization-aware pagination builds its record context from these
      // columns, so they ride along with any field selection.
      const authColumns = ['t.ticket_id', 't.status_id', 't.entered_by', 't.assigned_to', 't.client_id', 't.board_id', 't.assigned_team_id'];
      const plainSelects = new Set(selectParts.filter((p): p is string => typeof p === 'string'));
      for (const column of authColumns) {
        if (!plainSelects.has(column)) selectParts.push(column);
      }

      dataQuery = dataQuery.select(selectParts);
    }

    // Execute queries
    const [tickets, [{ count }]] = await Promise.all([
      dataQuery,
      countQuery.count('* as count')
    ]);

    if (wants('tags')) {
      await this.attachTicketTags(knex, context.tenant, tickets as Array<Record<string, unknown>>);
    }

    return {
      data: tickets as ITicket[],
      total: parseInt(count as string)
    };
  }

  private async attachTicketTags(
    knex: Knex,
    tenant: string,
    tickets: Array<Record<string, unknown>>
  ): Promise<void> {
    const ticketIds = tickets
      .map((t) => t.ticket_id)
      .filter((id): id is string => typeof id === 'string');

    for (const ticket of tickets) {
      ticket.tags = [];
    }
    if (ticketIds.length === 0) return;

    const rows = await knex('tag_mappings as tm')
      .join('tag_definitions as td', function joinDefinitions() {
        this.on('tm.tenant', '=', 'td.tenant').andOn('tm.tag_id', '=', 'td.tag_id');
      })
      .where('tm.tenant', tenant)
      .where('tm.tagged_type', 'ticket')
      .whereIn('tm.tagged_id', ticketIds)
      .select(
        'tm.mapping_id as tag_id',
        'tm.tagged_id',
        'td.tag_text',
        'td.background_color',
        'td.text_color'
      )
      .orderBy('td.tag_text', 'asc');

    const byTicket = new Map<string, Array<Record<string, unknown>>>();
    for (const row of rows) {
      const list = byTicket.get(row.tagged_id) ?? [];
      list.push({
        tag_id: row.tag_id,
        tag_text: row.tag_text,
        background_color: row.background_color,
        text_color: row.text_color,
      });
      byTicket.set(row.tagged_id, list);
    }

    for (const ticket of tickets) {
      ticket.tags = byTicket.get(ticket.ticket_id as string) ?? [];
    }
  }

  private normalizeTicketListFields(fields?: string[]): string[] | null {
    if (!fields || fields.length === 0) return null;
    let requested = fields.map((f) => f.trim()).filter(Boolean);

    if (requested.includes('mobile_list')) {
      requested = [...TICKET_MOBILE_LIST_FIELDS];
    }

    const unknown = requested.filter((f) => !TICKET_LIST_FIELD_ALLOWLIST.has(f));
    if (unknown.length > 0) {
      throw new ValidationError(`Unknown fields requested: ${unknown.join(', ')}`);
    }

    return Array.from(new Set(requested));
  }

  /**
   * Get ticket by ID with all related data
   */
  async getById(id: string, context: ServiceContext): Promise<ITicket | null> {
    const { knex } = await this.getKnex();
    this.assertValidTicketId(id);

    const ticket = await knex('tickets as t')
      .leftJoin('clients as comp', function() {
        this.on('t.client_id', '=', 'comp.client_id')
            .andOn('t.tenant', '=', 'comp.tenant');
      })
      .leftJoin('client_locations as cl', function() {
        this.on('t.tenant', '=', 'cl.tenant')
            .andOn('t.client_id', '=', 'cl.client_id')
            .andOn(function() {
              this.on('t.location_id', '=', 'cl.location_id')
                  .orOn(function() {
                    this.onNull('t.location_id')
                        .andOn('cl.is_default', '=', knex.raw('true'));
                  });
            });
      })
      .modify((queryBuilder) => applyDefaultContactPhoneJoin(queryBuilder, knex))
      .leftJoin('statuses as stat', function() {
        this.on('t.status_id', '=', 'stat.status_id')
            .andOn('t.tenant', '=', 'stat.tenant');
      })
      .leftJoin('priorities as pri', function() {
        this.on('t.priority_id', '=', 'pri.priority_id')
            .andOn('t.tenant', '=', 'pri.tenant');
      })
      .leftJoin('categories as cat', function() {
        this.on('t.category_id', '=', 'cat.category_id')
            .andOn('t.tenant', '=', 'cat.tenant');
      })
      .leftJoin('users as assigned_user', function() {
        this.on('t.assigned_to', '=', 'assigned_user.user_id')
            .andOn('t.tenant', '=', 'assigned_user.tenant');
      })
      .select(
        't.*',
        'comp.client_name',
        'cl.location_name as location_name',
        'cl.email as client_email',
        'cl.phone as client_phone',
        'cont.full_name as contact_name',
        'cont.email as contact_email',
        'cpn_default.phone_number as contact_phone',
        'stat.name as status_name',
        'stat.is_closed as status_is_closed',
        'pri.priority_name',
        'cat.category_name',
        knex.raw(`CASE 
          WHEN assigned_user.first_name IS NOT NULL AND assigned_user.last_name IS NOT NULL 
          THEN CONCAT(assigned_user.first_name, ' ', assigned_user.last_name) 
          ELSE NULL 
        END as assigned_to_name`)
      )
      .where({ 't.ticket_id': id, 't.tenant': context.tenant })
      .first();

    if (!ticket) {
      return null;
    }

    const [documents, contactAvatarUrl, clientLogoUrl] = await Promise.all([
      this.getTicketDocuments(id, context),
      ticket.contact_name_id ? getContactAvatarUrl(ticket.contact_name_id, context.tenant) : Promise.resolve(null),
      ticket.client_id ? getClientLogoUrl(ticket.client_id, context.tenant) : Promise.resolve(null),
    ]);

    return {
      ...this.withDescriptionHtml(ticket as ITicketWithDetails),
      documents,
      contact_avatar_url: contactAvatarUrl,
      client_logo_url: clientLogoUrl,
    } as ITicketWithDetails;
  }

  async getTicketDocuments(ticketId: string, context: ServiceContext): Promise<IDocument[]> {
    const { knex } = await this.getKnex();
    this.assertValidTicketId(ticketId);

    const documents = await knex('documents as d')
      .join('document_associations as da', function () {
        this.on('d.document_id', '=', 'da.document_id')
          .andOn('d.tenant', '=', 'da.tenant');
      })
      .leftJoin('users as u', function () {
        this.on('d.created_by', '=', 'u.user_id')
          .andOn('d.tenant', '=', 'u.tenant');
      })
      .leftJoin('document_types as dt', function () {
        this.on('d.type_id', '=', 'dt.type_id')
          .andOn('d.tenant', '=', 'dt.tenant');
      })
      .leftJoin('shared_document_types as sdt', 'd.shared_type_id', 'sdt.type_id')
      .where({
        'da.entity_id': ticketId,
        'da.entity_type': 'ticket',
        'da.tenant': context.tenant,
        'd.tenant': context.tenant
      })
      .select(
        'd.*',
        'da.association_id',
        'da.created_at as association_created_at',
        knex.raw("CONCAT(u.first_name, ' ', u.last_name) as created_by_full_name"),
        knex.raw('COALESCE(dt.type_name, sdt.type_name) as type_name'),
        knex.raw('COALESCE(dt.icon, sdt.icon) as type_icon')
      )
      .orderBy('d.updated_at', 'desc');

    return documents as IDocument[];
  }

  /**
   * List assets linked to a ticket (asset_associations -> assets).
   */
  async getTicketAssets(ticketId: string, context: ServiceContext): Promise<any[]> {
    const { knex } = await this.getKnex();
    this.assertValidTicketId(ticketId);

    const assets = await knex('asset_associations as aa')
      .join('assets as a', function joinAssets(this: Knex.JoinClause) {
        this.on('aa.asset_id', '=', 'a.asset_id')
          .andOn('aa.tenant', '=', 'a.tenant');
      })
      .leftJoin('clients as c', function joinClients(this: Knex.JoinClause) {
        this.on('a.client_id', '=', 'c.client_id')
          .andOn('a.tenant', '=', 'c.tenant');
      })
      .where({
        'aa.entity_id': ticketId,
        'aa.entity_type': 'ticket',
        'aa.tenant': context.tenant,
        'a.tenant': context.tenant
      })
      .select(
        'a.*',
        'c.client_name',
        'aa.relationship_type',
        'aa.notes as association_notes',
        'aa.created_at as linked_at'
      )
      .orderBy('aa.created_at', 'desc');

    return assets;
  }

  /**
   * Link an asset to a ticket by inserting an asset_associations row
   * (entity_type='ticket'). Same table getTicketAssets and the asset detail UI
   * read, so the link is visible from both sides.
   */
  async linkAsset(
    ticketId: string,
    data: { asset_id: string; relationship_type?: string; notes?: string },
    context: ServiceContext
  ): Promise<any> {
    const { knex } = await this.getKnex();
    this.assertValidTicketId(ticketId);

    const ticket = await knex('tickets')
      .where({ tenant: context.tenant, ticket_id: ticketId })
      .first();
    if (!ticket) {
      throw new NotFoundError('Ticket not found');
    }

    const asset = await knex('assets')
      .where({ tenant: context.tenant, asset_id: data.asset_id })
      .first();
    if (!asset) {
      throw new NotFoundError('Asset not found');
    }

    const existing = await knex('asset_associations')
      .where({
        tenant: context.tenant,
        asset_id: data.asset_id,
        entity_id: ticketId,
        entity_type: 'ticket'
      })
      .first();
    if (existing) {
      throw new ConflictError('Asset is already linked to this ticket');
    }

    const [created] = await knex('asset_associations')
      .insert({
        tenant: context.tenant,
        asset_id: data.asset_id,
        entity_id: ticketId,
        entity_type: 'ticket',
        relationship_type: data.relationship_type || 'affected',
        notes: data.notes ?? null,
        created_by: context.userId,
        created_at: new Date().toISOString()
      })
      .returning('*');

    return created;
  }

  /**
   * Remove the asset_associations row linking an asset to a ticket.
   */
  async unlinkAsset(ticketId: string, assetId: string, context: ServiceContext): Promise<void> {
    const { knex } = await this.getKnex();
    this.assertValidTicketId(ticketId);

    const deleted = await knex('asset_associations')
      .where({
        tenant: context.tenant,
        asset_id: assetId,
        entity_id: ticketId,
        entity_type: 'ticket'
      })
      .del();

    if (!deleted) {
      throw new NotFoundError('Asset-ticket association not found');
    }
  }

  async uploadTicketDocument(ticketId: string, file: File, context: ServiceContext): Promise<IDocument> {
    const { knex } = await this.getKnex();
    this.assertValidTicketId(ticketId);

    const existingTicket = await knex('tickets')
      .select('ticket_id')
      .where({ ticket_id: ticketId, tenant: context.tenant })
      .first();

    if (!existingTicket) {
      throw new NotFoundError('Ticket not found');
    }

    if (!file) {
      throw new ValidationError('File is required', [
        { path: ['file'], message: 'file is required' },
      ]);
    }

    const mimeType = file.type || 'application/octet-stream';
    await StorageService.validateFileUpload(context.tenant, mimeType, file.size);

    const buffer = Buffer.from(await file.arrayBuffer());
    const uploadResult = await StorageService.uploadFile(context.tenant, buffer, file.name, {
      mime_type: mimeType,
      uploaded_by_id: context.userId,
    });

    const folderRecord = await knex('document_folders')
      .where({
        tenant: context.tenant,
        entity_id: ticketId,
        entity_type: 'ticket',
        folder_path: '/Tickets/Attachments',
      })
      .select('folder_path')
      .first();

    const typeResult = await this.getDocumentTypeIdForMime(knex, context.tenant, mimeType);
    const documentId = uuidv4();
    const document: IDocument = {
      document_id: documentId,
      document_name: file.name,
      type_id: typeResult.isShared ? null : typeResult.typeId,
      shared_type_id: typeResult.isShared ? typeResult.typeId : undefined,
      user_id: context.userId,
      order_number: 0,
      created_by: context.userId,
      tenant: context.tenant,
      file_id: uploadResult.file_id,
      storage_path: uploadResult.storage_path,
      mime_type: mimeType,
      file_size: file.size,
      folder_path: folderRecord?.folder_path,
    };

    await withTransaction(knex, async (trx) => {
      await trx('documents').insert(document);
      await trx('document_associations').insert({
        association_id: uuidv4(),
        document_id: documentId,
        entity_id: ticketId,
        entity_type: 'ticket',
        tenant: context.tenant,
      });

      // Activity-timeline entry for the document attachment. Stored inside
      // the same transaction so the timeline row never appears unless the
      // document and its association were also persisted.
      await writeTicketActivity(trx, {
        tenant: context.tenant,
        ticketId,
        eventType: TICKET_ACTIVITY_EVENT.DOCUMENT_ATTACHED,
        entityType: TICKET_ACTIVITY_ENTITY.DOCUMENT,
        entityId: documentId,
        actor: {
          actorType: TICKET_ACTIVITY_ACTOR.USER,
          userId: context.userId,
        },
        source: TICKET_ACTIVITY_SOURCE.API,
        details: {
          document_name: file.name,
          mime_type: mimeType,
          file_size: file.size,
        },
      });
    });

    const createdDocument = await this.getDocumentById(documentId, context);
    if (!createdDocument) {
      throw new Error('Uploaded document could not be loaded');
    }

    return createdDocument;
  }

  async downloadTicketDocument(
    ticketId: string,
    documentId: string,
    context: ServiceContext
  ): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
    const { knex } = await this.getKnex();
    this.assertValidTicketId(ticketId);

    // Verify the document belongs to this ticket and tenant
    const doc = await knex('documents as d')
      .join('document_associations as da', function () {
        this.on('da.document_id', '=', 'd.document_id').andOn('da.tenant', '=', 'd.tenant');
      })
      .where({
        'da.entity_id': ticketId,
        'da.entity_type': 'ticket',
        'd.document_id': documentId,
        'd.tenant': context.tenant,
      })
      .select('d.file_id', 'd.document_name', 'd.mime_type')
      .first();

    if (!doc || !doc.file_id) {
      throw new NotFoundError('Document not found');
    }

    const result = await StorageService.downloadFile(doc.file_id);
    return {
      buffer: result.buffer,
      fileName: doc.document_name || result.metadata.original_name,
      mimeType: doc.mime_type || result.metadata.mime_type,
    };
  }

  async deleteTicketDocument(
    ticketId: string,
    documentId: string,
    context: ServiceContext
  ): Promise<void> {
    const { knex } = await this.getKnex();
    this.assertValidTicketId(ticketId);

    const doc = await knex('documents as d')
      .join('document_associations as da', function () {
        this.on('da.document_id', '=', 'd.document_id').andOn('da.tenant', '=', 'd.tenant');
      })
      .where({
        'da.entity_id': ticketId,
        'da.entity_type': 'ticket',
        'd.document_id': documentId,
        'd.tenant': context.tenant,
      })
      .select('d.document_id', 'd.file_id', 'da.association_id')
      .first();

    if (!doc) {
      throw new NotFoundError('Document not found');
    }

    await withTransaction(knex, async (trx) => {
      await trx('document_associations')
        .where({ association_id: doc.association_id, tenant: context.tenant })
        .del();

      // Only delete the document itself if no other associations remain
      const remaining = await trx('document_associations')
        .where({ document_id: documentId, tenant: context.tenant })
        .count('* as count')
        .first();

      if (!remaining || Number(remaining.count) === 0) {
        await trx('documents')
          .where({ document_id: documentId, tenant: context.tenant })
          .del();
      }

      await writeTicketActivity(trx, {
        tenant: context.tenant,
        ticketId,
        eventType: TICKET_ACTIVITY_EVENT.DOCUMENT_REMOVED,
        entityType: TICKET_ACTIVITY_ENTITY.DOCUMENT,
        entityId: documentId,
        actor: {
          actorType: TICKET_ACTIVITY_ACTOR.USER,
          userId: context.userId,
        },
        source: TICKET_ACTIVITY_SOURCE.API,
        details: {
          association_id: doc.association_id,
        },
      });
    });
  }

  async getTicketMaterials(ticketId: string, context: ServiceContext): Promise<ITicketMaterial[]> {
    const { knex } = await this.getKnex();
    this.assertValidTicketId(ticketId);

    const materials = await knex('ticket_materials as tm')
      .leftJoin('service_catalog as sc', function () {
        this.on('tm.service_id', '=', 'sc.service_id')
          .andOn('tm.tenant', '=', 'sc.tenant');
      })
      .where({
        'tm.ticket_id': ticketId,
        'tm.tenant': context.tenant,
      })
      .select('tm.*', 'sc.service_name as service_name', 'sc.sku as sku')
      .orderBy('tm.created_at', 'desc');

    return materials as ITicketMaterial[];
  }

  async addTicketMaterial(
    ticketId: string,
    data: CreateTicketMaterialData,
    context: ServiceContext,
  ): Promise<ITicketMaterial> {
    const { knex } = await this.getKnex();
    this.assertValidTicketId(ticketId);

    const quantity = Math.floor(Number(data.quantity));
    if (!Number.isFinite(quantity) || quantity < 1) {
      throw new ValidationError('Validation failed', [
        { path: ['quantity'], message: 'quantity must be greater than 0' },
      ]);
    }

    const rate = Math.round(Number(data.rate));
    if (!Number.isFinite(rate) || rate < 0) {
      throw new ValidationError('Validation failed', [
        { path: ['rate'], message: 'rate must be 0 or greater' },
      ]);
    }

    const ticket = await knex('tickets')
      .where({ ticket_id: ticketId, tenant: context.tenant })
      .select('ticket_id', 'client_id')
      .first();

    if (!ticket) {
      throw new NotFoundError('Ticket not found');
    }

    if (!ticket.client_id) {
      throw new ValidationError('Validation failed', [
        { path: ['ticket_id'], message: 'ticket must be associated with a client' },
      ]);
    }

    const product = await knex('service_catalog')
      .where({
        tenant: context.tenant,
        service_id: data.service_id,
        item_kind: 'product',
      })
      .select('service_id')
      .first();

    if (!product) {
      throw new ValidationError('Validation failed', [
        { path: ['service_id'], message: 'service_id must reference an existing product' },
      ]);
    }

    const [createdMaterial] = await knex('ticket_materials')
      .insert({
        tenant: context.tenant,
        ticket_id: ticketId,
        client_id: ticket.client_id,
        service_id: data.service_id,
        quantity,
        rate,
        currency_code: data.currency_code,
        description: data.description ?? null,
        is_billed: false,
      })
      .returning('ticket_material_id');

    const material = await this.getTicketMaterialById(
      createdMaterial.ticket_material_id,
      context,
    );

    if (!material) {
      throw new Error('Created material could not be loaded');
    }

    return material;
  }

  private async getDocumentById(documentId: string, context: ServiceContext): Promise<IDocument | null> {
    const { knex } = await this.getKnex();

    const document = await knex('documents as d')
      .leftJoin('users as u', function () {
        this.on('d.created_by', '=', 'u.user_id')
          .andOn('d.tenant', '=', 'u.tenant');
      })
      .leftJoin('document_types as dt', function () {
        this.on('d.type_id', '=', 'dt.type_id')
          .andOn('d.tenant', '=', 'dt.tenant');
      })
      .leftJoin('shared_document_types as sdt', 'd.shared_type_id', 'sdt.type_id')
      .where({
        'd.document_id': documentId,
        'd.tenant': context.tenant,
      })
      .select(
        'd.*',
        knex.raw("CONCAT(u.first_name, ' ', u.last_name) as created_by_full_name"),
        knex.raw('COALESCE(dt.type_name, sdt.type_name) as type_name'),
        knex.raw('COALESCE(dt.icon, sdt.icon) as type_icon')
      )
      .first();

    return (document as IDocument | undefined) ?? null;
  }

  private async getTicketMaterialById(
    ticketMaterialId: string,
    context: ServiceContext,
  ): Promise<ITicketMaterial | null> {
    const { knex } = await this.getKnex();

    const material = await knex('ticket_materials as tm')
      .leftJoin('service_catalog as sc', function () {
        this.on('tm.service_id', '=', 'sc.service_id')
          .andOn('tm.tenant', '=', 'sc.tenant');
      })
      .where({
        'tm.ticket_material_id': ticketMaterialId,
        'tm.tenant': context.tenant,
      })
      .select('tm.*', 'sc.service_name as service_name', 'sc.sku as sku')
      .first();

    return (material as ITicketMaterial | undefined) ?? null;
  }

  private async getDocumentTypeIdForMime(
    knex: Knex,
    tenant: string,
    mimeType: string,
  ): Promise<{ typeId: string; isShared: boolean }> {
    const tenantType = await knex('document_types')
      .where({ tenant, type_name: mimeType })
      .first();

    if (tenantType) {
      return { typeId: tenantType.type_id, isShared: false };
    }

    const sharedType = await knex('shared_document_types')
      .where({ type_name: mimeType })
      .first();

    if (sharedType) {
      return { typeId: sharedType.type_id, isShared: true };
    }

    const generalType = `${mimeType.split('/')[0]}/*`;

    const generalTenantType = await knex('document_types')
      .where({ tenant, type_name: generalType })
      .first();

    if (generalTenantType) {
      return { typeId: generalTenantType.type_id, isShared: false };
    }

    const generalSharedType = await knex('shared_document_types')
      .where({ type_name: generalType })
      .first();

    if (generalSharedType) {
      return { typeId: generalSharedType.type_id, isShared: true };
    }

    const unknownType = await knex('shared_document_types')
      .where({ type_name: 'application/octet-stream' })
      .first();

    if (!unknownType) {
      throw new Error('Unknown document type not found in shared document types');
    }

    return { typeId: unknownType.type_id, isShared: true };
  }

  private assertValidTicketId(id: string): void {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      throw new ValidationError('Invalid ticket ID format');
    }
  }

  /**
   * Create new ticket
    // Override for BaseService compatibility  
    async create(data: Partial<ITicket>, context: ServiceContext): Promise<ITicket>;
    async create(data: CreateTicketData, context: ServiceContext): Promise<ITicket>;
    async create(data: CreateTicketData | Partial<ITicket>, context: ServiceContext): Promise<ITicket> {
      // Ensure we have required fields for CreateTicketData
      if (!data.client_id || !data.title || !data.board_id || !data.status_id || !data.priority_id) {
        throw new Error('Required ticket fields missing: client_id, title, board_id, status_id, priority_id');
      }
      return this.createTicket(data as CreateTicketData, context);
    }
  
    private async createTicket(data: CreateTicketData, context: ServiceContext): Promise<ITicket> {
   */
    // Override for BaseService compatibility  
    async create(data: Partial<ITicket>, context: ServiceContext): Promise<ITicket>;
    async create(data: CreateTicketData, context: ServiceContext): Promise<ITicket>;
    async create(data: CreateTicketData | Partial<ITicket>, context: ServiceContext): Promise<ITicket> {
      // Ensure we have required fields for CreateTicketData
      if (!data.client_id || !data.title || !data.board_id || !data.status_id || !data.priority_id) {
        throw new Error('Required ticket fields missing: client_id, title, board_id, status_id, priority_id');
      }
      return this.createTicket(data as CreateTicketData, context);
    }
  
    private async createTicket(data: CreateTicketData, context: ServiceContext): Promise<ITicket> {
      const { knex } = await this.getKnex();
  
      const fullTicket = await withTransaction(knex, async (trx) => {
        // Validate status belongs to the specified board before proceeding
        const statusBelongsToBoard = await TicketModel.validateStatusBelongsToBoard(
          data.status_id,
          data.board_id,
          context.tenant,
          trx
        );
        if (!statusBelongsToBoard.valid) {
          throw new ValidationError('Validation failed', [
            { path: ['status_id'], message: `status_id ${data.status_id} does not belong to board_id ${data.board_id}` }
          ]);
        }

        // Convert API data format to TicketModel input format
        const createTicketInput: CreateTicketInput = {
          title: data.title,
          url: data.url,
          board_id: data.board_id,
          client_id: data.client_id,
          location_id: data.location_id,
          contact_id: data.contact_name_id, // Maps to contact_name_id in database
          status_id: data.status_id,
          category_id: data.category_id,
          subcategory_id: data.subcategory_id,
          entered_by: context.userId,
          assigned_to: data.assigned_to,
          priority_id: data.priority_id,
          attributes: data.attributes,
          source: 'api',
          ticket_origin: TICKET_ORIGINS.API,
        };

        // Publish after the transaction commits so notification subscribers can
        // read the newly-created ticket on their own connections.
        const analyticsTracker = new ServerAnalyticsTracker();

        // Use shared TicketModel with retry logic and analytics
        const ticketResult = await TicketModel.createTicketWithRetry(
          createTicketInput,
          context.tenant,
          trx,
          {}, // validation options
          undefined,
          analyticsTracker,
          context.userId,
          3 // max retries
        );

        // Handle tags if provided (API service specific functionality)
        if (data.tags && data.tags.length > 0) {
          await this.handleTags(ticketResult.ticket_id, data.tags, context, trx);
        }

        // Get the full ticket data for return
        const fullTicket = await trx('tickets')
          .where({ ticket_id: ticketResult.ticket_id, tenant: context.tenant })
          .first();

        if (!fullTicket) {
          throw new Error('Failed to retrieve created ticket');
        }

        // Add tags to returned object if provided (temporary until proper tag system)
        if (data.tags && data.tags.length > 0) {
          (fullTicket as any).tags = data.tags;
        }

        // Activity-timeline row for REST API ticket creation.
        await writeTicketActivity(trx, {
          tenant: context.tenant,
          ticketId: ticketResult.ticket_id,
          eventType: TICKET_ACTIVITY_EVENT.CREATED,
          entityType: TICKET_ACTIVITY_ENTITY.TICKET,
          entityId: ticketResult.ticket_id,
          actor: {
            actorType: TICKET_ACTIVITY_ACTOR.API,
            userId: context.userId,
          },
          source: TICKET_ACTIVITY_SOURCE.API,
          details: {
            title: fullTicket.title,
            board_id: fullTicket.board_id,
            status_id: fullTicket.status_id,
            priority_id: fullTicket.priority_id,
            assigned_to: fullTicket.assigned_to,
            client_id: fullTicket.client_id,
            ticket_origin: TICKET_ORIGINS.API,
          },
        });

        return fullTicket as ITicket;
      });

      await this.safePublishEvent('TICKET_CREATED', context, {
        ticketId: fullTicket.ticket_id,
        userId: context.userId,
        createdByUserId: context.userId,
        createdAt: fullTicket.entered_at
          ? new Date(fullTicket.entered_at as unknown as string).toISOString()
          : new Date().toISOString(),
        source: 'api',
        board_id: fullTicket.board_id,
        priority_id: fullTicket.priority_id,
        client_id: fullTicket.client_id,
      });

      return fullTicket;
    }


  /**
   * Update ticket
   */
  async update(id: string, data: UpdateTicketData, context: ServiceContext): Promise<ITicket> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Get current ticket for event comparison
      const currentTicket = await trx('tickets')
        .where({ ticket_id: id, tenant: context.tenant })
        .first();

      if (!currentTicket) {
        throw new NotFoundError('Ticket not found');
      }

      // Remove undefined values from data object
      const cleanedData = { ...data };
      Object.keys(cleanedData).forEach(key => {
        if ((cleanedData as any)[key] === undefined) {
          delete (cleanedData as any)[key];
        }
      });

      // Close-rule override flags are request options, not ticket columns.
      const overrideCloseRules = (cleanedData as any).override_close_rules === true;
      const overrideCloseRulesReason = (cleanedData as any).override_close_rules_reason ?? null;
      delete (cleanedData as any).override_close_rules;
      delete (cleanedData as any).override_close_rules_reason;

      const isBoardChange =
        cleanedData.board_id !== undefined &&
        cleanedData.board_id !== currentTicket.board_id;

      if (isBoardChange && !cleanedData.status_id) {
        throw new ValidationError('Validation failed', [
          { path: ['status_id'], message: 'Changing the board requires selecting a status for the destination board' }
        ]);
      }

      if (cleanedData.status_id && cleanedData.status_id !== currentTicket.status_id) {
        const effectiveBoardId = cleanedData.board_id ?? currentTicket.board_id;
        const statusResult = effectiveBoardId
          ? await TicketModel.validateStatusBelongsToBoard(
            cleanedData.status_id,
            effectiveBoardId,
            context.tenant,
            trx
          )
          : {
            valid: false,
            error: 'Invalid status: board_id is required when selecting a ticket status'
          };

        if (!statusResult.valid) {
          throw new ValidationError('Validation failed', [
            { path: ['status_id'], message: statusResult.error || 'Status not found' }
          ]);
        }
      }
      
      // Pre-close validation gates: when this update flips the ticket from an
      // open to a closed status, enforce the board's close rules before any
      // writes. Surfaces as a 422 with structured failure details.
      if (cleanedData.status_id && cleanedData.status_id !== currentTicket.status_id) {
        const nextStatus = await trx('statuses')
          .where({ status_id: cleanedData.status_id, tenant: context.tenant })
          .first();
        const previousStatus = await trx('statuses')
          .where({ status_id: currentTicket.status_id, tenant: context.tenant })
          .first();
        if (nextStatus?.is_closed && !previousStatus?.is_closed) {
          const merged = { ...currentTicket, ...cleanedData };
          try {
            await enforceTicketCloseRules(trx, context.tenant, {
              ticket: {
                ticket_id: id,
                board_id: merged.board_id ?? null,
                category_id: merged.category_id ?? null,
                subcategory_id: merged.subcategory_id ?? null,
                priority_id: merged.priority_id ?? null,
                assigned_to: merged.assigned_to ?? null,
              },
              override: overrideCloseRules
                ? {
                    requested: true,
                    reason: overrideCloseRulesReason,
                    user: { user_id: context.userId, user_type: 'internal', tenant: context.tenant },
                  }
                : undefined,
              actor: { actorType: TICKET_ACTIVITY_ACTOR.USER, userId: context.userId },
              source: TICKET_ACTIVITY_SOURCE.API,
            });
          } catch (error) {
            if (error instanceof TicketCloseValidationError) {
              throw new ValidationError(
                'Ticket close rules not satisfied',
                error.failures.map((f) => ({
                  path: ['status_id'],
                  rule: f.rule,
                  message: f.message,
                  ...(f.meta ?? {}),
                }))
              );
            }
            throw error;
          }
        }
      }

      const updateData = {
        ...cleanedData,
        updated_by: context.userId,
        updated_at: knex.raw('now()')
      };

      // Update ticket
      const [ticket] = await trx('tickets')
        .where({ ticket_id: id, tenant: context.tenant })
        .update(updateData)
        .returning('*');

      // Handle tags if provided
      if (data.tags) {
        await this.handleTags(id, data.tags, context, trx);
      }

      // Publish appropriate events
      if (data.status_id && data.status_id !== currentTicket.status_id) {
        // Check if ticket is being closed or reopened
        const newStatus = await trx('statuses')
          .where({ status_id: data.status_id, tenant: context.tenant })
          .first();
        const oldStatus = await trx('statuses')
          .where({ status_id: currentTicket.status_id, tenant: context.tenant })
          .first();

        // Keep the ticket row's denormalized close flag aligned with the selected status.
        await trx('tickets')
          .where({ ticket_id: id, tenant: context.tenant })
          .update({ is_closed: !!newStatus?.is_closed });

        // Record closed_at / closed_by when transitioning to/from closed status
        if (newStatus?.is_closed && !oldStatus?.is_closed) {
          await trx('tickets')
            .where({ ticket_id: id, tenant: context.tenant })
            .update({ closed_at: new Date(), closed_by: context.userId });
        } else if (!newStatus?.is_closed && oldStatus?.is_closed) {
          await trx('tickets')
            .where({ ticket_id: id, tenant: context.tenant })
            .update({ closed_at: null, closed_by: null });
        }

        if (newStatus?.is_closed) {
          await this.safePublishEvent('TICKET_CLOSED', context, {
            ticketId: ticket.ticket_id,
            closedByUserId: context.userId,
            closedAt: new Date().toISOString(),
          });
        }
      }

      const structuredChanges: Record<string, { old: unknown; new: unknown }> = {};
      const trackedChangeFields: Array<keyof ITicket> = [
        'title',
        'url',
        'status_id',
        'priority_id',
        'assigned_to',
        'board_id',
        'category_id',
        'subcategory_id',
        'due_date',
      ];
      for (const field of trackedChangeFields) {
        const nextValue = (cleanedData as Record<string, unknown>)[field as string];
        const previousValue = (currentTicket as Record<string, unknown>)[field as string];
        if (nextValue !== undefined && nextValue !== previousValue) {
          structuredChanges[field as string] = {
            old: previousValue,
            new: nextValue,
          };
        }
      }

      await this.safePublishEvent('TICKET_UPDATED', context, {
        ticketId: ticket.ticket_id,
        updatedByUserId: context.userId,
        changes: structuredChanges,
      });

      // Activity-timeline row for REST API updates. Uses curated diff so
      // only user-meaningful field changes produce a timeline entry; no-op
      // updates result in no row.
      const curated = await buildCuratedTicketDiffWithLabels(
        trx,
        context.tenant,
        currentTicket,
        cleanedData as Record<string, unknown>,
      );
      if (hasCuratedChanges(curated)) {
        const changedKeys = Object.keys(curated);
        let activityEventType: string = TICKET_ACTIVITY_EVENT.UPDATED;
        if (changedKeys.length === 1) {
          const key = changedKeys[0];
          if (key === 'status_id') activityEventType = TICKET_ACTIVITY_EVENT.STATUS_CHANGED;
          else if (key === 'priority_id') activityEventType = TICKET_ACTIVITY_EVENT.PRIORITY_CHANGED;
          else if (key === 'assigned_to') {
            activityEventType =
              (cleanedData as Record<string, unknown>).assigned_to == null
                ? TICKET_ACTIVITY_EVENT.UNASSIGNED
                : TICKET_ACTIVITY_EVENT.ASSIGNED;
          } else if (key === 'board_id') activityEventType = TICKET_ACTIVITY_EVENT.BOARD_MOVED;
          else if (key === 'response_state') activityEventType = TICKET_ACTIVITY_EVENT.RESPONSE_STATE_CHANGED;
        }

        await writeTicketActivity(trx, {
          tenant: context.tenant,
          ticketId: id,
          eventType: activityEventType,
          entityType: TICKET_ACTIVITY_ENTITY.TICKET,
          entityId: id,
          actor: {
            actorType: TICKET_ACTIVITY_ACTOR.USER,
            userId: context.userId,
          },
          source: TICKET_ACTIVITY_SOURCE.API,
          changes: curated,
        });
      }

      return this.withDescriptionHtml(ticket as ITicket);
    });
  }

  private withDescriptionHtml<T extends ITicket>(ticket: T): T & { description_html: string } {
    return {
      ...ticket,
      description_html: renderTicketDescriptionHtml(ticket.attributes),
    };
  }

  /**
   * Create ticket from asset
   */
  async createFromAsset(data: CreateTicketFromAssetData, context: ServiceContext): Promise<ITicket> {
    const { knex } = await this.getKnex();

    const fullTicket = await withTransaction(knex, async (trx) => {
      // Verify asset exists
      const asset = await trx('assets')
        .where({ asset_id: data.asset_id, tenant: context.tenant })
        .first();

      if (!asset) {
        throw new NotFoundError('Asset not found');
      }

      // Validate status belongs to the specified board
      const statusBelongsToBoard = await TicketModel.validateStatusBelongsToBoard(
        data.status_id,
        data.board_id,
        context.tenant,
        trx
      );
      if (!statusBelongsToBoard.valid) {
        throw new ValidationError('Validation failed', [
          { path: ['status_id'], message: `status_id ${data.status_id} does not belong to board_id ${data.board_id}` }
        ]);
      }

      // Publish after the transaction commits so notification subscribers can
      // read the newly-created ticket on their own connections.
      const analyticsTracker = new ServerAnalyticsTracker();

      // Use shared TicketModel for asset ticket creation
      const ticketResult = await TicketModel.createTicketFromAsset(
        {
          title: data.title,
          description: data.description || '',
          priority_id: data.priority_id,
          status_id: data.status_id,
          board_id: data.board_id,
          asset_id: data.asset_id,
          client_id: data.client_id
        },
        context.userId,
        context.tenant,
        trx,
        undefined,
        analyticsTracker
      );

      // Link the asset to the new ticket in asset_associations — the same table
      // the UI and the ticket/asset association endpoints read. (The shared model
      // only records created_from_asset in the ticket attributes.)
      await trx('asset_associations').insert({
        tenant: context.tenant,
        asset_id: data.asset_id,
        entity_id: ticketResult.ticket_id,
        entity_type: 'ticket',
        relationship_type: 'affected',
        created_by: context.userId,
        created_at: new Date().toISOString()
      });

      // Get the full ticket data for return
      const fullTicket = await trx('tickets')
        .where({ ticket_id: ticketResult.ticket_id, tenant: context.tenant })
        .first();

      if (!fullTicket) {
        throw new Error('Failed to retrieve created ticket');
      }

      return fullTicket as ITicket;
    });

    await this.safePublishEvent('TICKET_CREATED', context, {
      ticketId: fullTicket.ticket_id,
      userId: context.userId,
      createdByUserId: context.userId,
      createdAt: fullTicket.entered_at
        ? new Date(fullTicket.entered_at as unknown as string).toISOString()
        : new Date().toISOString(),
      source: 'api',
      board_id: fullTicket.board_id,
      priority_id: fullTicket.priority_id,
      client_id: fullTicket.client_id,
    });

    return fullTicket;
  }

  /**
   * Get ticket comments
   */
  async getTicketComments(
    ticketId: string,
    context: ServiceContext,
    options?: { limit?: number; offset?: number; order?: 'asc' | 'desc'; contentFormat?: 'full' | 'markdown' }
  ): Promise<any[]> {
    const { knex } = await this.getKnex();

    const comments = await knex('comments as tc')
      .leftJoin('users as u', function() {
        this.on('tc.user_id', '=', 'u.user_id')
            .andOn('tc.tenant', '=', 'u.tenant');
      })
      .leftJoin('contacts as c', function() {
        this.on('tc.contact_id', '=', 'c.contact_name_id')
            .andOn('tc.tenant', '=', 'c.tenant');
      })
      .select(
        'tc.*',
        knex.raw(`CASE 
          WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL 
          THEN CONCAT(u.first_name, ' ', u.last_name) 
          ELSE NULL 
        END as created_by_name`),
        'c.contact_name_id as author_contact_id',
        'c.full_name as author_contact_name',
        'c.email as author_contact_email'
      )
      .where({
        'tc.ticket_id': ticketId,
        'tc.tenant': context.tenant
      })
      .orderBy('tc.created_at', options?.order ?? 'asc')
      .modify((query) => {
        if (options?.offset !== undefined) query.offset(options.offset);
        if (options?.limit !== undefined) query.limit(options.limit);
      });

    // Batch-fetch avatar URLs for all unique user IDs
    const userIds = [...new Set(comments.map(c => c.user_id).filter(Boolean))] as string[];
    const avatarMap: Record<string, string | null> = {};
    await Promise.all(
      userIds.map(async (uid) => {
        try {
          avatarMap[uid] = await getUserAvatarUrl(uid, context.tenant);
        } catch {
          avatarMap[uid] = null;
        }
      })
    );

    // Batch-fetch reactions for all comments
    const commentIds = comments.map(c => c.comment_id).filter(Boolean) as string[];
    let reactionsMap: Record<string, any[]> = {};
    let reactionUserNames: Record<string, string> = {};
    if (commentIds.length > 0) {
      const reactionRows = await knex('comment_reactions')
        .where({ tenant: context.tenant })
        .whereIn('comment_id', commentIds)
        .select('comment_id', 'emoji', 'user_id')
        .orderBy('created_at', 'asc');

      reactionsMap = aggregateReactions(reactionRows, 'comment_id', context.userId);

      const reactionUserIds = [...new Set(reactionRows.map(r => r.user_id))];
      if (reactionUserIds.length > 0) {
        const reactionUsers = await knex('users')
          .where({ tenant: context.tenant })
          .whereIn('user_id', reactionUserIds)
          .select('user_id', 'first_name', 'last_name');
        for (const u of reactionUsers) {
          reactionUserNames[u.user_id] = `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Unknown';
        }
      }
    }

    const useMarkdown = options?.contentFormat === 'markdown';

    // Map database fields to API response format
    return comments.map(comment => {
      if (useMarkdown) {
        // Compact format: only markdown text and metadata, no heavy BlockNote JSON or HTML
        return {
          comment_id: comment.comment_id,
          ticket_id: comment.ticket_id,
          markdown_content: comment.markdown_content || null,
          author_type: comment.author_type,
          is_internal: comment.is_internal,
          is_resolution: comment.is_resolution,
          created_at: comment.created_at,
          updated_at: comment.updated_at,
          created_by: comment.user_id ?? null,
          created_by_name: comment.created_by_name || comment.author_contact_name || null,
          author_contact_id: comment.author_contact_id || comment.contact_id || null,
          author_contact_name: comment.author_contact_name || null,
          // Threading fields (mobile threaded comments) — explicitly enumerated
          // here since the compact branch does not spread the raw row.
          thread_id: comment.thread_id ?? null,
          parent_comment_id: comment.parent_comment_id ?? null,
          deleted_at: comment.deleted_at ?? null,
        };
      }

      // Full branch: select('tc.*') above means ...comment already carries
      // thread_id / parent_comment_id / deleted_at — no explicit mapping needed.
      return {
        ...comment,
        comment_text: comment.note,
        markdown_content: comment.markdown_content || null,
        comment_html: renderTicketRichTextHtml(comment.note),
        created_by: comment.user_id ?? null,
        created_by_name: comment.created_by_name || comment.author_contact_name || null,
        created_by_avatar_url: comment.user_id ? (avatarMap[comment.user_id] ?? null) : null,
        author_contact_id: comment.author_contact_id || comment.contact_id || null,
        author_contact_name: comment.author_contact_name || null,
        author_contact_email: comment.author_contact_email || null,
        reactions: reactionsMap[comment.comment_id] ?? [],
        reaction_user_names: reactionUserNames,
      };
    });
  }

  /**
   * Add comment to ticket
   */
  async addComment(
    ticketId: string,
    data: CreateTicketCommentData,
    context: ServiceContext
  ): Promise<any> {
    const { knex } = await this.getKnex();

    const result = await withTransaction(knex, async (trx) => {
      // Verify ticket exists
      const ticket = await trx('tickets')
        .where({ ticket_id: ticketId, tenant: context.tenant })
        .first();

      if (!ticket) {
        throw new NotFoundError('Ticket not found');
      }

      const apiNowIso = new Date().toISOString();
      const apiParentCommentId = data.parent_comment_id || null;
      const apiIsReply = Boolean(apiParentCommentId);

      let apiCommentId: string;
      let apiThreadId: string;
      let apiIsInternal: boolean;

      if (apiIsReply) {
        // Reply: attach to the parent's existing thread and inherit its
        // visibility. Mirrors Comment.insert's parent/thread invariant — the
        // native composer never sends is_internal for replies, so the
        // schema-defaulted false is intentionally ignored here and the thread
        // root's visibility is inherited instead.
        const parent = await trx('comments as parent')
          .join('comment_threads as thread', function () {
            this.on('parent.tenant', 'thread.tenant')
              .andOn('parent.thread_id', 'thread.thread_id');
          })
          .select(
            'parent.ticket_id',
            'parent.thread_id',
            'parent.deleted_at',
            'thread.is_internal as thread_is_internal'
          )
          .where('parent.tenant', context.tenant)
          .where('parent.comment_id', apiParentCommentId)
          .first();

        if (!parent) {
          throw new NotFoundError('Parent comment not found');
        }
        if (parent.ticket_id !== ticketId) {
          throw new ValidationError('Parent comment must belong to the same ticket');
        }
        if (parent.deleted_at) {
          throw new ValidationError('Cannot reply to a deleted comment');
        }

        const replyIds = await trx.raw('SELECT gen_random_uuid() AS comment_id');
        const replyGeneratedId = replyIds.rows?.[0]?.comment_id as string | undefined;
        if (!replyGeneratedId) {
          throw new Error('Failed to generate comment identifier');
        }

        apiCommentId = replyGeneratedId;
        apiThreadId = parent.thread_id;
        apiIsInternal = Boolean(parent.thread_is_internal);
      } else {
        // comments.thread_id is NOT NULL — generate IDs and create the thread row first.
        const apiCommentIds = await trx.raw(
          'SELECT gen_random_uuid() AS comment_id, gen_random_uuid() AS thread_id'
        );
        const apiGeneratedIds = apiCommentIds.rows?.[0] as
          | { comment_id: string; thread_id: string }
          | undefined;
        if (!apiGeneratedIds?.comment_id || !apiGeneratedIds?.thread_id) {
          throw new Error('Failed to generate comment/thread identifiers');
        }

        apiCommentId = apiGeneratedIds.comment_id;
        apiThreadId = apiGeneratedIds.thread_id;
        apiIsInternal = data.is_internal || false;

        await trx('comment_threads').insert({
          tenant: context.tenant,
          thread_id: apiThreadId,
          ticket_id: ticketId,
          project_task_id: null,
          root_comment_id: apiCommentId,
          is_internal: apiIsInternal,
          reply_count: 0,
          last_activity_at: apiNowIso,
          created_at: apiNowIso,
          created_by: context.userId || null,
        });
      }

      const commentData = {
        comment_id: apiCommentId,
        thread_id: apiThreadId,
        parent_comment_id: apiParentCommentId,
        ticket_id: ticketId,
        note: data.comment_text,
        is_internal: apiIsInternal,
        is_resolution: data.is_resolution || false,
        user_id: context.userId,
        tenant: context.tenant,
        created_at: apiNowIso,
        updated_at: apiNowIso,
        metadata: data.metadata,
      };

      const [comment] = await trx('comments').insert(commentData).returning('*');

      if (apiIsReply) {
        await trx('comment_threads')
          .where({ tenant: context.tenant, thread_id: apiThreadId })
          .update({
            reply_count: trx.raw('reply_count + 1'),
            last_activity_at: apiNowIso,
          });
      }

      if (!comment.is_internal) {
        await maybeReopenBundleMasterFromChildReply(trx, context.tenant, ticketId, context.userId);
      }

      // Update ticket updated_at
      await trx('tickets')
        .where({ ticket_id: ticketId, tenant: context.tenant })
        .update({
          updated_by: context.userId,
          updated_at: knex.raw('now()')
        });

      // Get user details for event
      const user = await trx('users')
        .select('first_name', 'last_name')
        .where({ user_id: context.userId, tenant: context.tenant })
        .first();

      const authorName = user ? `${user.first_name} ${user.last_name}` : 'Unknown User';

      // Map database fields to API response format
      const response = {
        ...comment,
        comment_text: comment.note,
        comment_html: renderTicketRichTextHtml(comment.note),
        created_by: comment.user_id ?? null,
        author_contact_id: comment.contact_id ?? null,
        author_contact_name: null,
        author_contact_email: null
      };

      return {
        response,
        eventPayload: {
          ticketId: ticketId,
          userId: context.userId,
          comment: {
            id: comment.comment_id,
            content: comment.note,
            author: authorName,
            isInternal: comment.is_internal
          }
        }
      };
    });

    // Publish after the transaction commits so email and in-app notification
    // subscribers can load the ticket/comment rows reliably.
    await this.safePublishEvent('TICKET_COMMENT_ADDED', context, result.eventPayload);

    return result.response;
  }

  /**
   * Update an existing comment (only the comment author may edit)
   */
  async updateComment(
    ticketId: string,
    commentId: string,
    data: UpdateTicketCommentData,
    context: ServiceContext
  ): Promise<any> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      const comment = await trx('comments')
        .where({ comment_id: commentId, ticket_id: ticketId, tenant: context.tenant })
        .first();

      if (!comment) {
        throw new NotFoundError('Comment not found');
      }

      if (comment.is_system_generated) {
        throw new ValidationError('System-generated comments cannot be edited');
      }

      if (comment.user_id !== context.userId) {
        throw new ValidationError('You can only edit your own comments');
      }

      const [updated] = await trx('comments')
        .where({ comment_id: commentId, tenant: context.tenant })
        .update({
          note: data.comment_text,
          updated_at: knex.raw('now()'),
        })
        .returning('*');

      return {
        ...updated,
        comment_text: updated.note,
        comment_html: renderTicketRichTextHtml(updated.note),
        created_by: updated.user_id ?? null,
        author_contact_id: updated.contact_id ?? null,
      };
    });
  }

  /**
   * Search tickets
   */
  async search(searchData: TicketSearchData, context: ServiceContext): Promise<ITicket[]> {
    const { knex } = await this.getKnex();
    const searchStartTime = Date.now();

    let query = knex('tickets as t')
      .leftJoin('clients as comp', function() {
        this.on('t.client_id', '=', 'comp.client_id')
            .andOn('t.tenant', '=', 'comp.tenant');
      })
      .leftJoin('contacts as cont', function() {
        this.on('t.contact_name_id', '=', 'cont.contact_name_id')
            .andOn('t.tenant', '=', 'cont.tenant');
      })
      .leftJoin('statuses as stat', function() {
        this.on('t.status_id', '=', 'stat.status_id')
            .andOn('t.tenant', '=', 'stat.tenant');
      })
      .where('t.tenant', context.tenant);

    // Apply search filters
    if (!searchData.include_closed) {
      query = query.where('stat.is_closed', false);
    }

    if (searchData.status_ids && searchData.status_ids.length > 0) {
      query = query.whereIn('t.status_id', searchData.status_ids);
    }

    if (searchData.priority_ids && searchData.priority_ids.length > 0) {
      query = query.whereIn('t.priority_id', searchData.priority_ids);
    }

    if (searchData.client_ids && searchData.client_ids.length > 0) {
      query = query.whereIn('t.client_id', searchData.client_ids);
    }

    if (searchData.assigned_to_ids && searchData.assigned_to_ids.length > 0) {
      query = query.whereIn('t.assigned_to', searchData.assigned_to_ids);
    }

    // Apply search query
    const searchFields = searchData.fields || ['title', 'ticket_number'];
    query = query.where(subQuery => {
      searchFields.forEach((field, index) => {
        if (field === 'client_name') {
          if (index === 0) {
            subQuery.whereILike('comp.client_name', `%${searchData.query}%`);
          } else {
            subQuery.orWhereILike('comp.client_name', `%${searchData.query}%`);
          }
        } else if (field === 'contact_name') {
          if (index === 0) {
            subQuery.whereILike('cont.full_name', `%${searchData.query}%`);
          } else {
            subQuery.orWhereILike('cont.full_name', `%${searchData.query}%`);
          }
        } else {
          if (index === 0) {
            subQuery.whereILike(`t.${field}`, `%${searchData.query}%`);
          } else {
            subQuery.orWhereILike(`t.${field}`, `%${searchData.query}%`);
          }
        }
      });
    });

    // Execute query
    const tickets = await query
      .select(
        't.*',
        'comp.client_name',
        'cont.full_name as contact_name',
        'stat.name as status_name',
        'stat.is_closed as status_is_closed'
      )
      .limit(searchData.limit || 25)
      .orderBy('t.entered_at', 'desc');

    const searchDuration = Date.now() - searchStartTime;

    // Track search analytics
    analytics.capture(AnalyticsEvents.TICKET_SEARCHED, {
      query_length: searchData.query.length,
      search_fields: searchFields,
      filters_used: {
        status: !!searchData.status_ids?.length,
        priority: !!searchData.priority_ids?.length,
        client: !!searchData.client_ids?.length,
        assigned_to: !!searchData.assigned_to_ids?.length,
        include_closed: searchData.include_closed,
      },
      result_count: tickets.length,
      limit: searchData.limit || 25,
    }, context.userId);

    // Track search performance - commented out due to removed performanceTracker
    // performanceTracker.trackSearchPerformance(
    //   'ticket',
    //   searchData.query,
    //   tickets.length,
    //   searchDuration,
    //   context.userId,
    //   {
    //     search_complexity: searchFields.length,
    //     filter_count: Object.values({
    //       status: !!searchData.status_ids?.length,
    //       priority: !!searchData.priority_ids?.length,
    //       client: !!searchData.client_ids?.length,
    //       assigned_to: !!searchData.assigned_to_ids?.length,
    //     }).filter(Boolean).length
    //   }
    // );

    return tickets as ITicket[];
  }

  /**
   * Get ticket statistics
   */
  async getTicketStats(context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();

    const [
      totalStats,
      statusStats,
      priorityStats,
      categoryStats,
      boardStats,
      timeStats
    ] = await Promise.all([
      // Total and basic counts
      knex('tickets as t')
        .leftJoin('statuses as s', function() {
          this.on('t.status_id', '=', 's.status_id')
              .andOn('t.tenant', '=', 's.tenant');
        })
        .where('t.tenant', context.tenant)
        .select(
          knex.raw('COUNT(*) as total_tickets'),
          knex.raw('COUNT(CASE WHEN s.is_closed = false THEN 1 END) as open_tickets'),
          knex.raw('COUNT(CASE WHEN s.is_closed = true THEN 1 END) as closed_tickets'),
          knex.raw('COUNT(CASE WHEN t.assigned_to IS NULL THEN 1 END) as unassigned_tickets')
        )
        .first(),

      // Tickets by status
      knex('tickets as t')
        .leftJoin('statuses as s', function() {
          this.on('t.status_id', '=', 's.status_id')
              .andOn('t.tenant', '=', 's.tenant');
        })
        .where('t.tenant', context.tenant)
        .groupBy('s.status_id', 's.name')
        .select('s.status_id', 's.name as status_name', knex.raw('COUNT(*) as count')),

      // Tickets by priority
      knex('tickets as t')
        .leftJoin('priorities as p', function() {
          this.on('t.priority_id', '=', 'p.priority_id')
              .andOn('t.tenant', '=', 'p.tenant');
        })
        .where('t.tenant', context.tenant)
        .groupBy('p.priority_name')
        .select('p.priority_name', knex.raw('COUNT(*) as count')),

      // Tickets by category
      knex('tickets as t')
        .leftJoin('categories as c', function() {
          this.on('t.category_id', '=', 'c.category_id')
              .andOn('t.tenant', '=', 'c.tenant');
        })
        .where('t.tenant', context.tenant)
        .whereNotNull('t.category_id')
        .groupBy('c.category_name')
        .select('c.category_name', knex.raw('COUNT(*) as count')),

      // Tickets by board
      knex('tickets as t')
        .leftJoin('boards as ch', function() {
          this.on('t.board_id', '=', 'ch.board_id')
              .andOn('t.tenant', '=', 'ch.tenant');
        })
        .where('t.tenant', context.tenant)
        .groupBy('ch.board_name')
        .select('ch.board_name', knex.raw('COUNT(*) as count')),

      // Time-based statistics
      knex('tickets')
        .where('tenant', context.tenant)
        .select(
          knex.raw("COUNT(CASE WHEN entered_at >= CURRENT_DATE THEN 1 END) as tickets_created_today"),
          knex.raw("COUNT(CASE WHEN entered_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as tickets_created_this_week"),
          knex.raw("COUNT(CASE WHEN entered_at >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as tickets_created_this_month")
        )
        .first()
    ]);

    return {
      total_tickets: parseInt(totalStats.total_tickets),
      open_tickets: parseInt(totalStats.open_tickets),
      closed_tickets: parseInt(totalStats.closed_tickets),
      unassigned_tickets: parseInt(totalStats.unassigned_tickets),
      overdue_tickets: 0, // Would need SLA configuration to calculate
      tickets_by_status: statusStats.reduce((acc: any, row: any) => {
        const key = row.status_id || row.status_name || 'unknown';
        acc[key] = parseInt(row.count);
        return acc;
      }, {}),
      tickets_by_priority: priorityStats.reduce((acc: any, row: any) => {
        acc[row.priority_name] = parseInt(row.count);
        return acc;
      }, {}),
      tickets_by_category: categoryStats.reduce((acc: any, row: any) => {
        acc[row.category_name] = parseInt(row.count);
        return acc;
      }, {}),
      tickets_by_board: boardStats.reduce((acc: any, row: any) => {
        acc[row.board_name] = parseInt(row.count);
        return acc;
      }, {}),
      average_resolution_time: null, // Would need to calculate from closed tickets
      tickets_created_today: parseInt(timeStats.tickets_created_today),
      tickets_created_this_week: parseInt(timeStats.tickets_created_this_week),
      tickets_created_this_month: parseInt(timeStats.tickets_created_this_month)
    };
  }

  /**
   * Apply ticket-specific filters
   */
  private applyTicketFilters(query: Knex.QueryBuilder, filters: TicketFilterData): Knex.QueryBuilder {
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null) return;

      switch (key) {
        case 'title':
          query.whereILike('t.title', `%${value}%`);
          break;
        case 'ticket_number':
          query.whereILike('t.ticket_number', `%${value}%`);
          break;
        case 'board_id':
        case 'client_id':
        case 'location_id':
        case 'contact_name_id':
        case 'status_id':
        case 'status_ids':
        case 'category_id':
        case 'subcategory_id':
        case 'entered_by':
        case 'assigned_to':
        case 'priority_id':
          if (key === 'status_ids') {
            if (Array.isArray(value) && value.length > 0) {
              query.whereIn('t.status_id', value);
            }
            break;
          }
          query.where(`t.${key}`, value);
          break;
        case 'is_open':
          if (value) {
            query.whereExists(function() {
              this.select('*')
                  .from('statuses as s')
                  .whereRaw('s.status_id = t.status_id')
                  .andWhere('s.tenant', query.client.raw('t.tenant'))
                  .andWhere('s.is_closed', false);
            });
          }
          break;
        case 'is_closed':
          if (value) {
            query.whereExists(function() {
              this.select('*')
                  .from('statuses as s')
                  .whereRaw('s.status_id = t.status_id')
                  .andWhere('s.tenant', query.client.raw('t.tenant'))
                  .andWhere('s.is_closed', true);
            });
          }
          break;
        case 'has_assignment':
          if (value) {
            query.whereNotNull('t.assigned_to');
          } else {
            query.whereNull('t.assigned_to');
          }
          break;
        case 'client_name':
          query.whereExists(function() {
            this.select('*')
                .from('clients as c')
                .whereRaw('c.client_id = t.client_id')
                .andWhere('c.tenant', query.client.raw('t.tenant'))
                .andWhere('c.client_name', value);
          });
          break;
        case 'contact_name':
          query.whereExists(function() {
            this.select('*')
                .from('contacts as cn')
                .whereRaw('cn.contact_name_id = t.contact_name_id')
                .andWhere('cn.tenant', query.client.raw('t.tenant'))
                .andWhere('cn.full_name', value);
          });
          break;
        case 'board_name':
          query.whereExists(function() {
            this.select('*')
                .from('boards as b')
                .whereRaw('b.board_id = t.board_id')
                .andWhere('b.tenant', query.client.raw('t.tenant'))
                .andWhere('b.board_name', value);
          });
          break;
        case 'category_name':
          query.whereExists(function() {
            this.select('*')
                .from('categories as cat')
                .whereRaw('cat.category_id = t.category_id')
                .andWhere('cat.tenant', query.client.raw('t.tenant'))
                .andWhere('cat.category_name', value);
          });
          break;
        case 'tags':
          if (Array.isArray(value) && value.length > 0) {
            const tagTexts = (value as string[]).map(tag => tag.toLowerCase());
            query.whereExists(function() {
              this.select('*')
                  .from('tag_mappings as tm')
                  .join('tag_definitions as td', function() {
                    this.on('tm.tenant', '=', 'td.tenant')
                        .andOn('tm.tag_id', '=', 'td.tag_id');
                  })
                  .whereRaw('tm.tagged_id = t.ticket_id')
                  .andWhere('tm.tenant', query.client.raw('t.tenant'))
                  .andWhere('tm.tagged_type', 'ticket')
                  .whereRaw(
                    `LOWER(td.tag_text) IN (${tagTexts.map(() => '?').join(', ')})`,
                    tagTexts
                  );
            });
          }
          break;
        case 'search':
          if (this.searchableFields.length > 0) {
            query.where(subQuery => {
              this.searchableFields.forEach((field, index) => {
                if (index === 0) {
                  subQuery.whereILike(`t.${field}`, `%${value}%`);
                } else {
                  subQuery.orWhereILike(`t.${field}`, `%${value}%`);
                }
              });
              
              // Also search in client name
              subQuery.orWhereExists(function() {
                this.select('*')
                    .from('clients as c')
                    .whereRaw('c.client_id = t.client_id')
                    .andWhere('c.tenant', query.client.raw('t.tenant'))
                    .andWhereILike('c.client_name', `%${value}%`);
              });
            });
          }
          break;
        case 'updated_from':
          query.whereRaw('COALESCE(t.updated_at, t.entered_at) >= ?', [value]);
          break;
        case 'updated_to':
          query.whereRaw('COALESCE(t.updated_at, t.entered_at) <= ?', [value]);
          break;
        case 'priority_name':
          query.whereExists(function() {
            this.select('*')
                .from('priorities as p')
                .whereRaw('p.priority_id = t.priority_id')
                .andWhere('p.tenant', query.client.raw('t.tenant'))
                .andWhere('p.priority_name', value);
          });
          break;
        case 'status_name':
          query.whereExists(function() {
            this.select('*')
                .from('statuses as s')
                .whereRaw('s.status_id = t.status_id')
                .andWhere('s.tenant', query.client.raw('t.tenant'))
                .andWhere('s.name', value);
          });
          break;
        case 'entered_from':
          query.where('t.entered_at', '>=', value);
          break;
        case 'entered_to':
          query.where('t.entered_at', '<=', value);
          break;
        case 'closed_from':
          query.where('t.closed_at', '>=', value);
          break;
        case 'closed_to':
          query.where('t.closed_at', '<=', value);
          break;
        case 'created_from':
          query.where('t.entered_at', '>=', value);
          break;
        case 'created_to':
          query.where('t.entered_at', '<=', value);
          break;
      }
    });

    return query;
  }

  /**
   * Handle tag associations
   */
  private async handleTags(
    ticketId: string,
    tags: string[],
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<void> {
    // Tags are now handled through tag_definitions and tag_mappings tables
    // This is a placeholder - implement proper tag mapping if needed
    // For now, we'll skip tag handling to avoid referencing non-existent ticket_tags table
    console.log('Tag handling not implemented for normalized tag system:', tags);
  }

  /**
   * Safely publish events
   */
  private async safePublishEvent(eventType: string, context: ServiceContext, payload: Record<string, unknown>): Promise<void> {
    if (process.env.E2E_SKIP_APP_INIT === 'true') {
      return;
    }

    try {
      await publishWorkflowEvent({
        eventType: eventType as any,
        payload,
        ctx: {
          tenantId: context.tenant,
          actor: context.userId
            ? { actorType: 'USER', actorUserId: context.userId }
            : { actorType: 'SYSTEM' },
        },
      });
    } catch (error) {
      console.error(`Failed to publish ${eventType} event:`, error);
    }
  }

  // -------------------------------------------------------------------------
  // Ticket bundling
  //
  // Mirrors the behaviour of the in-app bundle server actions
  // (packages/tickets/src/actions/ticketBundleActions.ts) for the public REST
  // surface. Permission is enforced by the controller (ticket:update / :read);
  // these methods own tenant-scoped persistence, invariants, and workflow events.
  // -------------------------------------------------------------------------

  private async findBundleMasterIds(trx: Knex.Transaction, tenant: string, ticketIds: string[]): Promise<string[]> {
    if (ticketIds.length === 0) return [];
    const rows = await trx('tickets')
      .distinct('master_ticket_id')
      .where({ tenant })
      .whereIn('master_ticket_id', ticketIds);
    return rows.map((r: any) => r.master_ticket_id).filter(Boolean);
  }

  private async assertChildrenAreNotMasters(trx: Knex.Transaction, tenant: string, childIds: string[]): Promise<void> {
    const offending = await this.findBundleMasterIds(trx, tenant, childIds);
    if (offending.length === 0) return;

    const rows = await trx('tickets')
      .select('ticket_number')
      .where({ tenant })
      .whereIn('ticket_id', offending);
    const labels = rows
      .map((r: any) => r.ticket_number)
      .filter((n: any): n is string => typeof n === 'string' && n.length > 0);
    const listText = labels.length > 0 ? labels.join(', ') : offending.join(', ');
    const prefix = offending.length === 1
      ? `Ticket ${listText} is already a bundle master`
      : `Tickets ${listText} are already bundle masters`;
    throw new ConflictError(
      `${prefix} and cannot be added as children. Unbundle them first, or use one of them as the master.`
    );
  }

  async bundleTickets(
    context: ServiceContext,
    params: { masterTicketId: string; childTicketIds: string[]; mode: BundleMode }
  ): Promise<{ masterTicketId: string; childTicketIds: string[]; mode: BundleMode }> {
    const uniqueChildIds = Array.from(new Set(params.childTicketIds)).filter((id) => id !== params.masterTicketId);
    if (uniqueChildIds.length === 0) {
      throw new ValidationError('Select at least one child ticket different from the master.');
    }

    const { knex } = await this.getKnex();
    const result = await withTransaction(knex, async (trx) => {
      const tickets = await trx('tickets')
        .select('ticket_id', 'ticket_number', 'master_ticket_id')
        .where({ tenant: context.tenant })
        .whereIn('ticket_id', [params.masterTicketId, ...uniqueChildIds]);

      const byId = new Map(tickets.map((t: any) => [t.ticket_id, t]));
      if (!byId.has(params.masterTicketId)) {
        throw new NotFoundError('Master ticket not found.');
      }
      for (const childId of uniqueChildIds) {
        if (!byId.has(childId)) {
          throw new NotFoundError(`Child ticket not found: ${childId}`);
        }
      }

      const master = byId.get(params.masterTicketId);
      if (master.master_ticket_id) {
        throw new ValidationError('Cannot select a child ticket as the master.');
      }

      await this.assertChildrenAreNotMasters(trx, context.tenant, uniqueChildIds);

      for (const childId of uniqueChildIds) {
        const child = byId.get(childId);
        if (child.master_ticket_id) {
          throw new ConflictError(`Ticket is already bundled: ${child.ticket_number || childId}`);
        }
      }

      const updatedChildrenCount = await trx('tickets')
        .where({ tenant: context.tenant })
        .whereIn('ticket_id', uniqueChildIds)
        .whereNull('master_ticket_id')
        .update({
          master_ticket_id: params.masterTicketId,
          updated_by: context.userId,
          updated_at: new Date().toISOString(),
        });
      if (updatedChildrenCount !== uniqueChildIds.length) {
        throw new ConflictError('One or more selected tickets were bundled concurrently. Please refresh and try again.');
      }

      await trx('ticket_bundle_settings')
        .insert({
          tenant: context.tenant,
          master_ticket_id: params.masterTicketId,
          mode: params.mode,
          reopen_on_child_reply: false,
        })
        .onConflict(['tenant', 'master_ticket_id'])
        .merge({ mode: params.mode });

      return { masterTicketId: params.masterTicketId, childTicketIds: uniqueChildIds, mode: params.mode };
    });

    const occurredAt = new Date().toISOString();
    for (const childTicketId of result.childTicketIds) {
      await this.safePublishEvent('TICKET_MERGED', context, {
        sourceTicketId: childTicketId,
        targetTicketId: result.masterTicketId,
        mergedAt: occurredAt,
        reason: `bundle:${result.mode}`,
      });
    }

    return result;
  }

  async addBundleChildren(
    context: ServiceContext,
    params: { masterTicketId: string; childTicketIds: string[] }
  ): Promise<{ masterTicketId: string; childTicketIds: string[] }> {
    const childIds = Array.from(new Set(params.childTicketIds)).filter((id) => id !== params.masterTicketId);
    if (childIds.length === 0) {
      throw new ValidationError('No child tickets provided.');
    }

    const { knex } = await this.getKnex();
    const result = await withTransaction(knex, async (trx) => {
      const master = await trx('tickets')
        .select('ticket_id', 'master_ticket_id')
        .where({ tenant: context.tenant, ticket_id: params.masterTicketId })
        .first();
      if (!master) throw new NotFoundError('Master ticket not found.');
      if (master.master_ticket_id) throw new ValidationError('Cannot add children to a bundled child ticket.');

      const children = await trx('tickets')
        .select('ticket_id', 'ticket_number', 'master_ticket_id')
        .where({ tenant: context.tenant })
        .whereIn('ticket_id', childIds);
      const byId = new Map(children.map((t: any) => [t.ticket_id, t]));
      for (const childId of childIds) {
        const child = byId.get(childId);
        if (!child) throw new NotFoundError(`Child ticket not found: ${childId}`);
        if (child.master_ticket_id) throw new ConflictError(`Ticket is already bundled: ${child.ticket_number || childId}`);
      }

      await this.assertChildrenAreNotMasters(trx, context.tenant, childIds);

      const updatedChildrenCount = await trx('tickets')
        .where({ tenant: context.tenant })
        .whereIn('ticket_id', childIds)
        .whereNull('master_ticket_id')
        .update({
          master_ticket_id: params.masterTicketId,
          updated_by: context.userId,
          updated_at: new Date().toISOString(),
        });
      if (updatedChildrenCount !== childIds.length) {
        throw new ConflictError('One or more selected tickets were bundled concurrently. Please refresh and try again.');
      }

      return { masterTicketId: params.masterTicketId, childTicketIds: childIds };
    });

    const occurredAt = new Date().toISOString();
    for (const childTicketId of result.childTicketIds) {
      await this.safePublishEvent('TICKET_MERGED', context, {
        sourceTicketId: childTicketId,
        targetTicketId: result.masterTicketId,
        mergedAt: occurredAt,
        reason: 'bundle:added_children',
      });
    }

    return result;
  }

  async promoteBundleMaster(
    context: ServiceContext,
    params: { oldMasterTicketId: string; newMasterTicketId: string }
  ): Promise<{ oldMasterTicketId: string; newMasterTicketId: string }> {
    if (params.oldMasterTicketId === params.newMasterTicketId) {
      throw new ValidationError('New master ticket must be different from the current master.');
    }

    const { knex } = await this.getKnex();
    const result = await withTransaction(knex, async (trx) => {
      const oldMaster = await trx('tickets')
        .select('ticket_id', 'master_ticket_id')
        .where({ tenant: context.tenant, ticket_id: params.oldMasterTicketId })
        .first();
      if (!oldMaster) throw new NotFoundError('Old master ticket not found');
      if (oldMaster.master_ticket_id) throw new ValidationError('Old master ticket is not a master');

      const newMaster = await trx('tickets')
        .select('ticket_id', 'master_ticket_id')
        .where({ tenant: context.tenant, ticket_id: params.newMasterTicketId })
        .first();
      if (!newMaster) throw new NotFoundError('New master ticket not found');
      if (newMaster.master_ticket_id !== params.oldMasterTicketId) {
        throw new ValidationError('New master ticket must be a child of the current master');
      }

      const promotedMasterConflicts = await this.findBundleMasterIds(trx, context.tenant, [params.newMasterTicketId]);
      if (promotedMasterConflicts.length > 0) {
        throw new ConflictError('Promoted ticket already has children of its own.');
      }

      const now = new Date().toISOString();

      const settings = await trx('ticket_bundle_settings')
        .where({ tenant: context.tenant, master_ticket_id: params.oldMasterTicketId })
        .first();
      if (settings) {
        await trx('ticket_bundle_settings')
          .where({ tenant: context.tenant, master_ticket_id: params.oldMasterTicketId })
          .delete();
        await trx('ticket_bundle_settings')
          .insert({ ...settings, master_ticket_id: params.newMasterTicketId })
          .onConflict(['tenant', 'master_ticket_id'])
          .merge({ mode: settings.mode, reopen_on_child_reply: settings.reopen_on_child_reply });
      }

      await trx('tickets')
        .where({ tenant: context.tenant, master_ticket_id: params.oldMasterTicketId })
        .andWhereNot({ ticket_id: params.newMasterTicketId })
        .update({ master_ticket_id: params.newMasterTicketId, updated_by: context.userId, updated_at: now });

      await trx('tickets')
        .where({ tenant: context.tenant, ticket_id: params.newMasterTicketId })
        .update({ master_ticket_id: null, updated_by: context.userId, updated_at: now });

      await trx('tickets')
        .where({ tenant: context.tenant, ticket_id: params.oldMasterTicketId })
        .update({ master_ticket_id: params.newMasterTicketId, updated_by: context.userId, updated_at: now });

      return { oldMasterTicketId: params.oldMasterTicketId, newMasterTicketId: params.newMasterTicketId };
    });

    await this.safePublishEvent('TICKET_MERGED', context, {
      sourceTicketId: result.oldMasterTicketId,
      targetTicketId: result.newMasterTicketId,
      mergedAt: new Date().toISOString(),
      reason: 'bundle:promote_master',
    });

    return result;
  }

  async updateBundleSettings(
    context: ServiceContext,
    params: { masterTicketId: string; mode?: BundleMode; reopenOnChildReply?: boolean }
  ): Promise<{ master_ticket_id: string; mode: BundleMode; reopen_on_child_reply: boolean }> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      const existing = await trx('ticket_bundle_settings')
        .where({ tenant: context.tenant, master_ticket_id: params.masterTicketId })
        .first();
      if (!existing) throw new NotFoundError('Bundle settings not found');

      const update: any = {};
      if (params.mode) update.mode = params.mode;
      if (params.reopenOnChildReply !== undefined) update.reopen_on_child_reply = params.reopenOnChildReply;

      if (Object.keys(update).length === 0) {
        return {
          master_ticket_id: existing.master_ticket_id,
          mode: existing.mode,
          reopen_on_child_reply: existing.reopen_on_child_reply,
        };
      }

      const [updated] = await trx('ticket_bundle_settings')
        .where({ tenant: context.tenant, master_ticket_id: params.masterTicketId })
        .update(update)
        .returning(['master_ticket_id', 'mode', 'reopen_on_child_reply']);

      return updated;
    });
  }

  async removeBundleChild(
    context: ServiceContext,
    params: { childTicketId: string }
  ): Promise<{ masterTicketId: string; childTicketId: string; remainingChildren: number }> {
    const { knex } = await this.getKnex();
    const result = await withTransaction(knex, async (trx) => {
      const child = await trx('tickets')
        .select('ticket_id', 'master_ticket_id')
        .where({ tenant: context.tenant, ticket_id: params.childTicketId })
        .first();

      if (!child) throw new NotFoundError('Ticket not found');
      if (!child.master_ticket_id) throw new ValidationError('Ticket is not bundled');

      const masterTicketId = child.master_ticket_id;

      await trx('tickets')
        .where({ tenant: context.tenant, ticket_id: params.childTicketId })
        .update({ master_ticket_id: null, updated_by: context.userId, updated_at: new Date().toISOString() });

      const [{ count }] = await trx('tickets')
        .where({ tenant: context.tenant, master_ticket_id: masterTicketId })
        .count('ticket_id as count');
      const remaining = Number.parseInt(String(count), 10) || 0;
      if (remaining === 0) {
        await trx('ticket_bundle_settings')
          .where({ tenant: context.tenant, master_ticket_id: masterTicketId })
          .delete();
      }

      return { masterTicketId, childTicketId: params.childTicketId, remainingChildren: remaining };
    });

    await this.safePublishEvent('TICKET_SPLIT', context, {
      originalTicketId: result.masterTicketId,
      newTicketIds: [result.childTicketId],
      splitAt: new Date().toISOString(),
      reason: 'bundle:remove_child',
    });

    return result;
  }

  async unbundleMaster(
    context: ServiceContext,
    params: { masterTicketId: string }
  ): Promise<{ masterTicketId: string; childTicketIds: string[] }> {
    const { knex } = await this.getKnex();
    const result = await withTransaction(knex, async (trx) => {
      const master = await trx('tickets')
        .select('ticket_id', 'master_ticket_id')
        .where({ tenant: context.tenant, ticket_id: params.masterTicketId })
        .first();
      if (!master) throw new NotFoundError('Master ticket not found');
      if (master.master_ticket_id) throw new ValidationError('Cannot unbundle from a child ticket id');

      const childTicketRows = await trx('tickets')
        .select('ticket_id')
        .where({ tenant: context.tenant, master_ticket_id: params.masterTicketId });
      const childTicketIds = childTicketRows.map((r: any) => r.ticket_id);

      await trx('tickets')
        .where({ tenant: context.tenant, master_ticket_id: params.masterTicketId })
        .update({ master_ticket_id: null, updated_by: context.userId, updated_at: new Date().toISOString() });

      await trx('ticket_bundle_settings')
        .where({ tenant: context.tenant, master_ticket_id: params.masterTicketId })
        .delete();

      return { masterTicketId: params.masterTicketId, childTicketIds };
    });

    if (result.childTicketIds.length > 0) {
      await this.safePublishEvent('TICKET_SPLIT', context, {
        originalTicketId: result.masterTicketId,
        newTicketIds: result.childTicketIds,
        splitAt: new Date().toISOString(),
        reason: 'bundle:unbundle_master',
      });
    }

    return result;
  }

  async getBundle(context: ServiceContext, ticketId: string): Promise<BundleView> {
    const { knex } = await this.getKnex();
    const memberColumns = ['ticket_id', 'ticket_number', 'title', 'status_id', 'client_id'];

    return withTransaction(knex, async (trx) => {
      const ticket = await trx('tickets')
        .select('ticket_id', 'master_ticket_id')
        .where({ tenant: context.tenant, ticket_id: ticketId })
        .first();
      if (!ticket) throw new NotFoundError('Ticket not found');

      const masterTicketId: string = ticket.master_ticket_id || ticket.ticket_id;

      const master = await trx('tickets')
        .select(memberColumns)
        .where({ tenant: context.tenant, ticket_id: masterTicketId })
        .first();

      const children = await trx('tickets')
        .select(memberColumns)
        .where({ tenant: context.tenant, master_ticket_id: masterTicketId })
        .orderBy('ticket_number', 'asc');

      const settingsRow = await trx('ticket_bundle_settings')
        .select('mode', 'reopen_on_child_reply')
        .where({ tenant: context.tenant, master_ticket_id: masterTicketId })
        .first();

      let role: BundleView['role'];
      if (ticket.master_ticket_id) {
        role = 'child';
      } else {
        role = children.length > 0 ? 'master' : 'standalone';
      }

      return {
        role,
        master_ticket_id: masterTicketId,
        master: master ?? null,
        children,
        settings: settingsRow
          ? { mode: settingsRow.mode, reopen_on_child_reply: settingsRow.reopen_on_child_reply }
          : null,
      };
    });
  }
}
