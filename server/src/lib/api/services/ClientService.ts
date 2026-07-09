/**
 * Client Service
 * Business logic for client-related operations
 */

import { Knex } from 'knex';
import { BaseService, ServiceContext, ListResult, tenantDb, withTransaction } from '@alga-psa/db';
import { IClient, IClientLocation } from 'server/src/interfaces/client.interfaces';
import { getClientLogoUrl } from '@alga-psa/formatting/avatarUtils';
import { createDefaultTaxSettingsInternal } from '@alga-psa/billing/actions';
import { isEnterprise } from '@alga-psa/core';
import { deleteEntityWithValidation } from '@alga-psa/core/server';
import { NotFoundError, ValidationError } from '../../api/middleware/apiMiddleware';
import {
  CreateClientData,
  UpdateClientData,
  ClientFilterData,
  CreateClientLocationData,
  UpdateClientLocationData
} from '../schemas/client';
import { ListOptions } from '../controllers/types';
import { runWithTenant } from 'server/src/lib/db';
import { publishWorkflowEvent } from 'server/src/lib/eventBus/publishers';
import {
  buildClientArchivedPayload,
  buildClientCreatedPayload,
  buildClientOwnerAssignedPayload,
  buildClientStatusChangedPayload,
  buildClientUpdatedPayload,
} from '@alga-psa/workflow-streams';
import { buildContactPrimarySetPayload } from '@alga-psa/workflow-streams';
import {
  ensureDefaultContractForClientIfBillingConfigured,
} from '@alga-psa/shared/billingClients/defaultContract';

function maybeUserActorFromContext(context: ServiceContext) {
  if (typeof context.userId !== 'string' || !context.userId) return undefined;
  return { actorType: 'USER' as const, actorUserId: context.userId };
}

function scopedTable<Row extends object = Record<string, any>>(
  conn: Knex | Knex.Transaction,
  tenant: string,
  tableExpression: string
): Knex.QueryBuilder<any, any> {
  return tenantDb(conn, tenant).table<Row>(tableExpression) as Knex.QueryBuilder<any, any>;
}

async function getExistingPublicTables(
  trx: Knex.Transaction,
  tenantId: string,
  tableNames: string[]
): Promise<Set<string>> {
  const rows = await tenantDb(trx, tenantId)
    .unscoped('information_schema.tables', 'schema discovery for optional Entra client cleanup tables')
    .select('table_name')
    .where({ table_schema: 'public' })
    .whereIn('table_name', tableNames);

  return new Set((rows as Array<{ table_name: string }>).map((row) => row.table_name));
}

async function cleanupEntraReferencesBeforeClientDelete(
  trx: Knex.Transaction,
  tenantId: string,
  clientId: string
): Promise<void> {
  if (!isEnterprise) {
    return;
  }

  const tableNames = [
    'entra_sync_run_tenants',
    'entra_contact_links',
    'entra_contact_reconciliation_queue',
    'entra_client_tenant_mappings',
  ];
  const existingTables = await getExistingPublicTables(trx, tenantId, tableNames);
  if (existingTables.size === 0) {
    return;
  }

  const now = trx.fn.now();
  const db = tenantDb(trx, tenantId);

  if (existingTables.has('entra_sync_run_tenants')) {
    await db.table('entra_sync_run_tenants')
      .where({ client_id: clientId })
      .update({ client_id: null, updated_at: now });
  }

  if (existingTables.has('entra_contact_links')) {
    await db.table('entra_contact_links')
      .where({ client_id: clientId })
      .update({ client_id: null, updated_at: now });
  }

  if (existingTables.has('entra_contact_reconciliation_queue')) {
    await db.table('entra_contact_reconciliation_queue')
      .where({ client_id: clientId })
      .update({ client_id: null, updated_at: now });
  }

  if (existingTables.has('entra_client_tenant_mappings')) {
    const activeMappings = await db.table('entra_client_tenant_mappings')
      .where({
        client_id: clientId,
        is_active: true,
      })
      .select('managed_tenant_id');

    if (activeMappings.length > 0) {
      await db.table('entra_client_tenant_mappings')
        .where({
          client_id: clientId,
          is_active: true,
        })
        .update({
          is_active: false,
          updated_at: now,
        });

      const unmappedRows = (activeMappings as Array<{ managed_tenant_id: string }>).map((mapping) => ({
        tenant: tenantId,
        managed_tenant_id: mapping.managed_tenant_id,
        client_id: null,
        mapping_state: 'unmapped',
        confidence_score: null,
        is_active: true,
        decided_by: null,
        decided_at: now,
        created_at: now,
        updated_at: now,
      }));

      await db.table('entra_client_tenant_mappings').insert(unmappedRows);
    }

    await db.table('entra_client_tenant_mappings')
      .where({ client_id: clientId })
      .update({ client_id: null, updated_at: now });
  }
}

export class ClientService extends BaseService<IClient> {
  constructor() {
    super({
      tableName: 'clients',
      primaryKey: 'client_id',
      tenantColumn: 'tenant',
      searchableFields: ['client_name', 'email', 'phone_no', 'address'],
      defaultSort: 'client_name',
      defaultOrder: 'asc'
    });
  }

  /**
   * List clients with enhanced filtering and search
   */
  async list(options: ListOptions, context: ServiceContext): Promise<ListResult<IClient>> {
    const { knex } = await this.getKnex();

    const {
      page = 1,
      limit = 25,
      filters = {} as ClientFilterData,
      sort,
      order
    } = options;

    return withTransaction(knex, async (trx) => {
      const db = tenantDb(trx, context.tenant);
      // Build base query with account manager and location joins
      let dataQuery = db.table('clients as c');
      db.tenantJoin(dataQuery, 'users as u', 'c.account_manager_id', 'u.user_id', { type: 'left' });
      db.tenantJoin(dataQuery, 'client_locations as cl', 'c.client_id', 'cl.client_id', {
        type: 'left',
        on(join) {
          join.andOn('cl.is_default', '=', trx.raw('true'));
        },
      });

      let countQuery = db.table('clients as c');
      db.tenantJoin(countQuery, 'client_locations as cl', 'c.client_id', 'cl.client_id', {
        type: 'left',
        on(join) {
          join.andOn('cl.is_default', '=', trx.raw('true'));
        },
      });

      // Apply filters
      dataQuery = this.applyClientFilters(dataQuery, filters);
      countQuery = this.applyClientFilters(countQuery, filters);

      // Apply sorting
      const sortField = sort || this.defaultSort;
      const sortOrder = order || this.defaultOrder;
      dataQuery = dataQuery.orderBy(`c.${sortField}`, sortOrder);

      // Apply pagination
      const offset = (page - 1) * limit;
      dataQuery = dataQuery.limit(limit).offset(offset);

      // Select fields
      dataQuery = dataQuery.select(
        'c.*',
        trx.raw(`CASE WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL THEN CONCAT(u.first_name, ' ', u.last_name) ELSE NULL END as account_manager_full_name`)
      );

      // Execute queries
      const [clients, [{ count }]] = await Promise.all([
        dataQuery,
        countQuery.count('* as count') as unknown as Promise<Array<{ count: string }>>
      ]);

      // Add logo URLs
      const clientsWithLogos = await Promise.all(
        (clients as IClient[]).map(async (client) => {
          const logoUrl = await getClientLogoUrl(client.client_id, context.tenant);
          return { ...client, logoUrl };
        })
      );

      return {
        data: clientsWithLogos,
        total: parseInt(count as string)
      };
    });
  }

  /**
   * Get client by ID with account manager and logo
   */
  async getById(id: string, context: ServiceContext): Promise<IClient | null> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      const db = tenantDb(trx, context.tenant);
      const clientQuery = db.table<IClient>('clients as c');
      db.tenantJoin(clientQuery, 'users as u', 'c.account_manager_id', 'u.user_id', { type: 'left' });

      const client = await clientQuery
        .select(
          'c.*',
          trx.raw(`CASE WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL THEN CONCAT(u.first_name, ' ', u.last_name) ELSE NULL END as account_manager_full_name`)
        )
        .where({ 'c.client_id': id })
        .first();

      if (!client) {
        return null;
      }

      // Get logo URL
      const logoUrl = await getClientLogoUrl(id, context.tenant);

      return {
        ...client,
        logoUrl
      } as unknown as IClient;
    });
  }

  /**
   * Create new client with default settings   */
  async create(data: Partial<IClient>, context: ServiceContext): Promise<IClient> {
    const { knex } = await this.getKnex();
    const client = await withTransaction(knex, async (trx) => {
      // Prepare client data
      const clientData = {
        client_id: knex.raw('gen_random_uuid()'),
        client_name: data.client_name,
        url: data.url || '',
        client_type: data.client_type,
        tax_id_number: data.tax_id_number,
        notes: data.notes,
        properties: data.properties,
        payment_terms: data.payment_terms,
        billing_cycle: data.billing_cycle,
        credit_balance: 0,
        credit_limit: data.credit_limit,
        preferred_payment_method: data.preferred_payment_method,
        auto_invoice: data.auto_invoice || false,
        invoice_delivery_method: data.invoice_delivery_method,
        region_code: data.region_code,
        is_tax_exempt: data.is_tax_exempt || false,
        tax_exemption_certificate: data.tax_exemption_certificate,
        timezone: data.timezone,
        invoice_template_id: data.invoice_template_id,
        billing_contact_id: data.billing_contact_id,
        billing_email: data.billing_email,
        account_manager_id: data.account_manager_id,
        is_inactive: data.is_inactive || false,
        tenant: context.tenant,
        created_at: knex.raw('now()'),
        updated_at: knex.raw('now()')
      };

      // Insert into clients table
      const [client] = await tenantDb(trx, context.tenant).table('clients').insert(clientData).returning('*');

      await ensureDefaultContractForClientIfBillingConfigured(trx, {
        tenant: context.tenant,
        clientId: client.client_id,
      });

      // Handle tags if provided
      if ((data as any).tags && (data as any).tags.length > 0) {
        try {
          await this.handleTags(client.client_id, (data as any).tags, context, trx);
        } catch (tagError) {
          console.warn('Failed to handle tags:', tagError);
          // Continue without tags - they can be added later
        }
      }

      return client;
    });

    // Try to create default tax settings for the client with tenant context (after transaction)
    try {
      await runWithTenant(context.tenant, async () => {
        await createDefaultTaxSettingsInternal(client.client_id);
      });
    } catch (taxError) {
      console.warn('Failed to create default tax settings:', taxError);
      // Continue without tax settings - they can be added later
    }

    const createdAt = (client as any).created_at ?? new Date().toISOString();
    const status =
      (client as any)?.properties?.status ??
      ((client as any)?.is_inactive ? 'inactive' : 'active');
    await publishWorkflowEvent({
      eventType: 'CLIENT_CREATED',
      payload: buildClientCreatedPayload({
        clientId: client.client_id,
        clientName: client.client_name,
        createdByUserId: typeof context.userId === 'string' ? context.userId : undefined,
        createdAt,
        status,
      }),
      ctx: {
        tenantId: context.tenant,
        occurredAt: createdAt,
        actor: maybeUserActorFromContext(context),
      },
      idempotencyKey: `client_created:${client.client_id}`,
    });

    return client;
  }

  async delete(id: string, context: ServiceContext): Promise<void> {
    const { knex } = await this.getKnex();

    const client = await scopedTable(knex, context.tenant, 'clients')
      .where({ client_id: id })
      .select('client_id')
      .first();
    if (!client?.client_id) {
      throw new NotFoundError('Client not found');
    }

    const isDefaultClient = await scopedTable(knex, context.tenant, 'tenant_companies')
      .where({
        client_id: id,
        is_default: true,
      })
      .first();
    if (isDefaultClient) {
      throw new ValidationError(
        'Cannot delete the default client. Please set another client as default in General Settings first.'
      );
    }

    const result = await deleteEntityWithValidation('client', id, knex, context.tenant, async (trx, tenantId) => {
      await this.cleanupClientDeleteArtifacts(trx, tenantId, id);
      await this.cleanupClientNotesDocument(trx, tenantId, id);
      await cleanupEntraReferencesBeforeClientDelete(trx, tenantId, id);

      const deleted = await scopedTable(trx, tenantId, 'clients')
        .where({ client_id: id })
        .delete();
      if (!deleted) {
        throw new NotFoundError('Client not found');
      }
    });

    if (!result.deleted) {
      throw new ValidationError(result.message ?? 'Unable to delete client.');
    }

    const occurredAt = new Date().toISOString();
    await publishWorkflowEvent({
      eventType: 'CLIENT_DELETED',
      payload: {
        clientId: id,
        deletedByUserId: typeof context.userId === 'string' ? context.userId : undefined,
        deletedAt: occurredAt,
      },
      ctx: {
        tenantId: context.tenant,
        occurredAt,
        actor: maybeUserActorFromContext(context),
      },
      idempotencyKey: `client_deleted:${id}:${occurredAt}`,
    });
  }

  private async cleanupClientDeleteArtifacts(
    trx: Knex.Transaction,
    tenant: string,
    clientId: string
  ): Promise<void> {
    await this.cleanupDefaultContractsForDeletedClient(trx, tenant, clientId);
    await this.deleteFromTenantTableIfExists(trx, tenant, 'client_billing_settings', { client_id: clientId });
    await this.deleteFromTenantTableIfExists(trx, tenant, 'client_billing_cycles', { client_id: clientId });
    await this.deleteFromTenantTableIfExists(trx, tenant, 'client_tax_settings', { client_id: clientId });
    await this.deleteFromTenantTableIfExists(trx, tenant, 'client_tax_rates', { client_id: clientId });
    await this.deleteFromTenantTableIfExists(trx, tenant, 'client_locations', { client_id: clientId });
    await this.deleteFromTenantTableIfExists(trx, tenant, 'client_payment_customers', { client_id: clientId });
    await this.deleteFromTenantTableIfExists(trx, tenant, 'tag_mappings', {
      tagged_type: 'client',
      tagged_id: clientId,
    });
  }

  private async cleanupClientNotesDocument(
    trx: Knex.Transaction,
    tenant: string,
    clientId: string
  ): Promise<void> {
    const clientRecord = await scopedTable<{ notes_document_id: string | null }>(trx, tenant, 'clients')
      .where({ client_id: clientId })
      .select('notes_document_id')
      .first();

    if (!clientRecord?.notes_document_id) {
      return;
    }

    await this.deleteFromTenantTableIfExists(trx, tenant, 'document_block_content', {
      document_id: clientRecord.notes_document_id,
    });
    await this.deleteFromTenantTableIfExists(trx, tenant, 'document_associations', {
      document_id: clientRecord.notes_document_id,
    });
    await this.deleteFromTenantTableIfExists(trx, tenant, 'documents', {
      document_id: clientRecord.notes_document_id,
    });
  }

  private async cleanupDefaultContractsForDeletedClient(
    trx: Knex.Transaction,
    tenant: string,
    clientId: string
  ): Promise<void> {
    const db = tenantDb(trx, tenant);
    const defaultContracts = await db.table('contracts')
      .where({
        owner_client_id: clientId,
        is_system_managed_default: true,
      })
      .select('contract_id');

    const assignmentsForClient = await db.table('client_contracts')
      .where({ client_id: clientId })
      .select('client_contract_id', 'contract_id');

    const assignmentsById = new Map<string, string>();
    for (const assignment of assignmentsForClient) {
      assignmentsById.set(assignment.client_contract_id, assignment.contract_id);
    }

    const invoicedDefaultContractIds = new Set<string>();
    if (assignmentsById.size > 0) {
      const invoiceRows = await db.table('invoice_charges')
        .whereIn('client_contract_id', [...assignmentsById.keys()])
        .distinct('client_contract_id');
      for (const row of invoiceRows) {
        const contractId = assignmentsById.get(row.client_contract_id);
        if (contractId) {
          invoicedDefaultContractIds.add(contractId);
        }
      }
    }

    await db.table('client_contracts')
      .where({ client_id: clientId })
      .delete();

    for (const contract of defaultContracts) {
      const countRow = await db.table('client_contracts')
        .where({ contract_id: contract.contract_id })
        .count<{ count?: string }>('client_contract_id as count')
        .first();
      const assignmentCount = Number(countRow?.count ?? 0);
      if (assignmentCount > 0) {
        continue;
      }

      if (invoicedDefaultContractIds.has(contract.contract_id)) {
        await db.table('contracts')
          .where({ contract_id: contract.contract_id })
          .update({
            status: 'archived',
            is_active: false,
            updated_at: trx.fn.now(),
          });
      } else {
        await db.table('contracts')
          .where({ contract_id: contract.contract_id })
          .delete();
      }
    }
  }

  private async deleteFromTenantTableIfExists(
    trx: Knex.Transaction,
    tenant: string,
    tableName: string,
    where: Record<string, unknown>
  ): Promise<void> {
    if (!await trx.schema.hasTable(tableName)) {
      return;
    }
    await scopedTable(trx, tenant, tableName).where(where).delete();
  }

  /**
   * Create client with typed data
   */
  async createClient(data: CreateClientData, context: ServiceContext): Promise<IClient> {
    return this.create(data as Partial<IClient>, context);
  }

  /**
   * Update client   */
  async update(id: string, data: UpdateClientData, context: ServiceContext): Promise<IClient> {
    const { knex } = await this.getKnex();
    const result = await withTransaction(knex, async (trx) => {
      const db = tenantDb(trx, context.tenant);
      const before = await db.table('clients')
        .where('client_id', id)
        .first();

      if (!before) {
        throw new NotFoundError('Client not found');
      }

      // Prepare update data
      const updateData: any = {
        ...data,
        updated_at: knex.raw('now()'),
      };

      // Remove undefined values + non-column fields
      Object.keys(updateData).forEach((key) => {
        if (updateData[key] === undefined) {
          delete updateData[key];
        }
      });
      delete updateData.tags;

      const updatedFieldKeys = Object.keys(updateData);

      // Update client
      const [client] = await db.table('clients')
        .where('client_id', id)
        .update(updateData)
        .returning('*');

      if (!client) {
        throw new NotFoundError('Client not found');
      }

      // If the client is being set to inactive, update all associated contacts and users
      if (data.is_inactive === true) {
        // Get all contact IDs for this client
        const contacts = await db.table('contacts')
          .select('contact_name_id')
          .where({ client_id: id });

        const contactIds = contacts.map((c) => c.contact_name_id);

        // Deactivate all contacts
        await db.table('contacts')
          .where({ client_id: id })
          .update({ is_inactive: true });

        // Deactivate all users associated with these contacts
        if (contactIds.length > 0) {
          await db.table('users')
            .whereIn('contact_id', contactIds)
            .andWhere({ user_type: 'client' })
            .update({ is_inactive: true });
        }
      }

      // Handle tags if provided
      if (data.tags !== undefined) {
        try {
          await this.handleTags(id, data.tags, context, trx);
        } catch (tagError) {
          console.warn('Failed to handle tags:', tagError);
          // Continue without tags - they can be added later
        }
      }

      return { before, after: client, updatedFieldKeys };
    });

    const occurredAt = (result.after as any).updated_at ?? new Date().toISOString();
    const actor = maybeUserActorFromContext(context);

    const previousLifecycleStatus = (result.before as any)?.properties?.status;
    const newLifecycleStatus = (result.after as any)?.properties?.status;
    if (
      typeof previousLifecycleStatus === 'string' &&
      typeof newLifecycleStatus === 'string' &&
      previousLifecycleStatus &&
      newLifecycleStatus &&
      previousLifecycleStatus !== newLifecycleStatus
    ) {
      await publishWorkflowEvent({
        eventType: 'CLIENT_STATUS_CHANGED',
        payload: buildClientStatusChangedPayload({
          clientId: id,
          previousStatus: previousLifecycleStatus,
          newStatus: newLifecycleStatus,
          changedAt: occurredAt,
        }),
        ctx: { tenantId: context.tenant, occurredAt, actor },
        idempotencyKey: `client_status_changed:${id}:${occurredAt}`,
      });
    }

    const previousOwnerUserId = (result.before as any)?.account_manager_id;
    const newOwnerUserId = (result.after as any)?.account_manager_id;
    if (previousOwnerUserId !== newOwnerUserId && typeof newOwnerUserId === 'string' && newOwnerUserId) {
      await publishWorkflowEvent({
        eventType: 'CLIENT_OWNER_ASSIGNED',
        payload: buildClientOwnerAssignedPayload({
          clientId: id,
          previousOwnerUserId: typeof previousOwnerUserId === 'string' ? previousOwnerUserId : undefined,
          newOwnerUserId,
          assignedByUserId: typeof context.userId === 'string' ? context.userId : undefined,
          assignedAt: occurredAt,
        }),
        ctx: { tenantId: context.tenant, occurredAt, actor },
        idempotencyKey: `client_owner_assigned:${id}:${occurredAt}`,
      });
    }

    const wasInactive = Boolean((result.before as any)?.is_inactive);
    const isInactive = Boolean((result.after as any)?.is_inactive);
    if (!wasInactive && isInactive) {
      await publishWorkflowEvent({
        eventType: 'CLIENT_ARCHIVED',
        payload: buildClientArchivedPayload({
          clientId: id,
          archivedByUserId: typeof context.userId === 'string' ? context.userId : undefined,
          archivedAt: occurredAt,
        }),
        ctx: { tenantId: context.tenant, occurredAt, actor },
        idempotencyKey: `client_archived:${id}:${occurredAt}`,
      });
    }

    const updatedPayload = buildClientUpdatedPayload({
      clientId: id,
      before: result.before as any,
      after: result.after as any,
      updatedFieldKeys: result.updatedFieldKeys ?? [],
      updatedAt: occurredAt,
    });

    const updatedFields = (updatedPayload as any).updatedFields;
    const changes = (updatedPayload as any).changes;
    if ((Array.isArray(updatedFields) && updatedFields.length) || (changes && Object.keys(changes).length)) {
      await publishWorkflowEvent({
        eventType: 'CLIENT_UPDATED',
        payload: updatedPayload,
        ctx: { tenantId: context.tenant, occurredAt, actor },
        idempotencyKey: `client_updated:${id}:${occurredAt}`,
      });
    }

    const previousBillingContactId = (result.before as any)?.billing_contact_id;
    const newBillingContactId = (result.after as any)?.billing_contact_id;
    if (
      previousBillingContactId !== newBillingContactId &&
      typeof newBillingContactId === 'string' &&
      newBillingContactId
    ) {
      await publishWorkflowEvent({
        eventType: 'CONTACT_PRIMARY_SET',
        payload: buildContactPrimarySetPayload({
          clientId: id,
          contactId: newBillingContactId,
          previousPrimaryContactId:
            typeof previousBillingContactId === 'string' && previousBillingContactId ? previousBillingContactId : undefined,
          setByUserId: typeof context.userId === 'string' ? context.userId : undefined,
          setAt: occurredAt,
        }),
        ctx: { tenantId: context.tenant, occurredAt, actor },
        idempotencyKey: `contact_primary_set:${id}:${newBillingContactId}:${occurredAt}`,
      });
    }

    return result.after as IClient;
  }

  /**
   * Get client locations
   */
  async getClientLocations(clientId: string, context: ServiceContext): Promise<IClientLocation[]> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      const locations = await scopedTable<IClientLocation>(trx, context.tenant, 'client_locations')
        .where({
          client_id: clientId
        })
        .orderBy('is_default', 'desc')
        .orderBy('location_name', 'asc');

      return locations;
    });
  }

  /**
   * Create client location   */
  async createLocation(
    clientId: string,
    data: CreateClientLocationData,
    context: ServiceContext
  ): Promise<IClientLocation> {
    const { knex } = await this.getKnex();
    return withTransaction(knex, async (trx) => {
      // Verify client exists
      const client = await scopedTable(trx, context.tenant, 'clients')
        .where({ client_id: clientId })
        .first();

      if (!client) {
        throw new NotFoundError('Client not found');
      }

      const locationData = {
        location_id: knex.raw('gen_random_uuid()'),
        client_id: clientId,
        ...data,
        tenant: context.tenant,
        created_at: knex.raw('now()'),
        updated_at: knex.raw('now()')
      };

      const [location] = await tenantDb(trx, context.tenant).table('client_locations')
        .insert(locationData)
        .returning('*');

      return location as IClientLocation;
    });
  }

  /**
   * Update client location   */
  async updateLocation(
    clientId: string,
    locationId: string,
    data: UpdateClientLocationData,
    context: ServiceContext
  ): Promise<IClientLocation> {
    const { knex } = await this.getKnex();
    return withTransaction(knex, async (trx) => {
      const db = tenantDb(trx, context.tenant);
      const updateData: any = {
        ...data,
        updated_at: knex.raw('now()')
      };

      // Remove undefined values
      Object.keys(updateData).forEach(key => {
        if (updateData[key] === undefined) {
          delete updateData[key];
        }
      });

      const [location] = await db.table('client_locations')
        .where('location_id', locationId)
        .where('client_id', clientId)
        .update(updateData)
        .returning('*');

      if (!location) {
        throw new NotFoundError('Client location not found');
      }

      return location as IClientLocation;
    });
  }

  /**
   * Delete client location   */
  async deleteLocation(
    clientId: string,
    locationId: string,
    context: ServiceContext
  ): Promise<void> {
    const { knex } = await this.getKnex();
    return withTransaction(knex, async (trx) => {
      const result = await scopedTable(trx, context.tenant, 'client_locations')
        .where({
          location_id: locationId,
          client_id: clientId
        })
        .delete();

      if (result === 0) {
        throw new NotFoundError('Location not found');
      }

    });
  }

  /**
   * Get client statistics
   */
  async getClientStats(context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      const clientsTable = scopedTable(trx, context.tenant, 'clients');
      const [
        totalStats,
        billingCycleStats,
        clientTypeStats,
        creditStats
      ] = await Promise.all([
        // Total and active/inactive counts
        clientsTable.clone()
          .select(
            trx.raw('COUNT(*) as total_clients'),
            trx.raw('COUNT(CASE WHEN is_inactive = false THEN 1 END) as active_clients'),
            trx.raw('COUNT(CASE WHEN is_inactive = true THEN 1 END) as inactive_clients')
          )
          .first(),

        // Clients by billing cycle
        clientsTable.clone()
          .groupBy('billing_cycle')
          .select('billing_cycle', trx.raw('COUNT(*) as count')),

        // Clients by client type
        clientsTable.clone()
          .whereNotNull('client_type')
          .groupBy('client_type')
          .select('client_type', trx.raw('COUNT(*) as count')),

        // Credit balance statistics
        clientsTable.clone()
          .select(
            trx.raw('SUM(credit_balance) as total_credit_balance'),
            trx.raw('AVG(credit_balance) as average_credit_balance')
          )
          .first()
      ]);

      return {
        total_clients: parseInt(totalStats.total_clients),
        active_clients: parseInt(totalStats.active_clients),
        inactive_clients: parseInt(totalStats.inactive_clients),
        clients_by_billing_cycle: billingCycleStats.reduce((acc: any, row: any) => {
          acc[row.billing_cycle] = parseInt(row.count);
          return acc;
        }, {}),
        clients_by_client_type: clientTypeStats.reduce((acc: any, row: any) => {
          acc[row.client_type] = parseInt(row.count);
          return acc;
        }, {}),
        total_credit_balance: parseFloat(creditStats.total_credit_balance || '0'),
        average_credit_balance: parseFloat(creditStats.average_credit_balance || '0')
      };
    });
  }

  /**
   * Apply client-specific filters
   */
  private applyClientFilters(query: Knex.QueryBuilder, filters: ClientFilterData): Knex.QueryBuilder {
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null) return;

      switch (key) {
        case 'client_name':
          query.whereILike('c.client_name', `%${value}%`);
          break;
        case 'email':
          query.whereILike('cl.email', `%${value}%`);
          break;
        case 'client_type':
          query.where('c.client_type', value);
          break;
        case 'billing_cycle':
          query.where('c.billing_cycle', value);
          break;
        case 'is_inactive':
          query.where('c.is_inactive', value);
          break;
        case 'is_tax_exempt':
          query.where('c.is_tax_exempt', value);
          break;
        case 'account_manager_id':
          query.where('c.account_manager_id', value);
          break;
        case 'region_code':
          query.where('c.region_code', value);
          break;
        case 'credit_balance_min':
          query.where('c.credit_balance', '>=', value);
          break;
        case 'credit_balance_max':
          query.where('c.credit_balance', '<=', value);
          break;
        case 'has_credit_limit':
          if (value) {
            query.whereNotNull('c.credit_limit');
          } else {
            query.whereNull('c.credit_limit');
          }
          break;
        case 'industry':
          query.whereRaw("c.properties->>'industry' = ?", [value]);
          break;
        case 'company_size':
          query.whereRaw("c.properties->>'company_size' = ?", [value]);
          break;
        case 'search':
          if (this.searchableFields.length > 0) {
            query.where(subQuery => {
              this.searchableFields.forEach((field, index) => {
                if (field === 'email') {
                  if (index === 0) {
                    subQuery.whereILike('cl.email', `%${value}%`);
                  } else {
                    subQuery.orWhereILike('cl.email', `%${value}%`);
                  }
                } else if (field === 'phone_no') {
                  if (index === 0) {
                    subQuery.whereILike('cl.phone', `%${value}%`);
                  } else {
                    subQuery.orWhereILike('cl.phone', `%${value}%`);
                  }
                } else if (field === 'address') {
                  if (index === 0) {
                    subQuery.where(addressSubQuery => {
                      addressSubQuery.whereILike('cl.address_line1', `%${value}%`)
                        .orWhereILike('cl.address_line2', `%${value}%`)
                        .orWhereILike('cl.city', `%${value}%`)
                        .orWhereILike('cl.state_province', `%${value}%`)
                        .orWhereILike('cl.postal_code', `%${value}%`);
                    });
                  } else {
                    subQuery.orWhere(addressSubQuery => {
                      addressSubQuery.whereILike('cl.address_line1', `%${value}%`)
                        .orWhereILike('cl.address_line2', `%${value}%`)
                        .orWhereILike('cl.city', `%${value}%`)
                        .orWhereILike('cl.state_province', `%${value}%`)
                        .orWhereILike('cl.postal_code', `%${value}%`);
                    });
                  }
                } else {
                  if (index === 0) {
                    subQuery.whereILike(`c.${field}`, `%${value}%`);
                  } else {
                    subQuery.orWhereILike(`c.${field}`, `%${value}%`);
                  }
                }
              });
            });
          }
          break;
        case 'created_from':
          query.where('c.created_at', '>=', value);
          break;
        case 'created_to':
          query.where('c.created_at', '<=', value);
          break;
        case 'updated_from':
          query.where('c.updated_at', '>=', value);
          break;
        case 'updated_to':
          query.where('c.updated_at', '<=', value);
          break;
      }
    });

    return query;
  }

  /**
   * Handle tag associations
   */
  private async handleTags(
    clientId: string,
    tags: string[],
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<void> {
    const db = tenantDb(trx, context.tenant);
    // Remove existing tag mappings for this client
    const existingMappings = await db.table('tag_mappings')
      .where({
        tagged_id: clientId,
        tagged_type: 'client'
      })
      .select('tag_id');

    if (existingMappings.length > 0) {
      await db.table('tag_mappings')
        .where({
          tagged_id: clientId,
          tagged_type: 'client'
        })
        .delete();
    }

    // Add new tags
    if (tags.length > 0) {
      for (const tagText of tags) {
        // First, ensure the tag definition exists
        let tagDef = await db.table('tag_definitions')
          .where({
            tag_text: tagText,
            tagged_type: 'client'
          })
          .first();

        if (!tagDef) {
          // Create the tag definition
          const [newTagDef] = await db.table('tag_definitions')
            .insert({
              tenant: context.tenant,
              tag_text: tagText,
              tagged_type: 'client',
              created_at: trx.raw('now()')
            })
            .returning('*');
          tagDef = newTagDef;
        }

        const tagId = tagDef?.tag_id;
        if (!tagId) {
          throw new Error('Tag definition upsert completed without returning a tag ID.');
        }

        // Create the mapping
        await db.table('tag_mappings')
          .insert({
            tenant: context.tenant,
            tag_id: tagId,
            tagged_id: clientId,
            tagged_type: 'client',
            created_by: context.userId,
            created_at: trx.raw('now()')
          });
      }
    }
  }
}
