'use server'

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import type { InboundTicketDefaults } from '@alga-psa/types';
import {
  actionError,
  type ActionMessageError,
} from '@alga-psa/ui/lib/errorHandling';

type InboundTicketDefaultsActionError = ActionMessageError;

class ExpectedInboundTicketDefaultsError extends Error {
  readonly messageKey?: string;

  constructor(message: string, messageKey?: string) {
    super(message);
    this.name = 'ExpectedInboundTicketDefaultsError';
    this.messageKey = messageKey;
  }
}

function expectedInboundTicketDefaultsError(message: string, messageKey?: string): never {
  throw new ExpectedInboundTicketDefaultsError(message, messageKey);
}

type DefaultsKnex = Awaited<ReturnType<typeof createTenantKnex>>['knex'];

const normalizeUuid = (v?: string | null) => (v && v !== 'no-category' ? v : null);

// Inbound processing passes defaults.location_id straight into ticket creation,
// where it is rejected if it belongs to another client. Catch that at save time.
const assertLocationBelongsToClient = async (
  knex: DefaultsKnex,
  tenant: string,
  clientId: string | null | undefined,
  locationId: string
): Promise<void> => {
  if (!clientId) {
    expectedInboundTicketDefaultsError(
      'Select a client before selecting a location',
      'msp/email-providers:errors.inboundDefaults.locationRequiresClient'
    );
  }

  const location = await tenantDb(knex, tenant).table('client_locations')
    .where({ location_id: locationId, client_id: clientId })
    .first('location_id');

  if (!location) {
    expectedInboundTicketDefaultsError(
      'The selected location does not belong to the selected client',
      'msp/email-providers:errors.inboundDefaults.locationClientMismatch'
    );
  }
};

const assertTicketStatusBelongsToBoard = async (
  knex: DefaultsKnex,
  tenant: string,
  boardId: string,
  statusId: string
): Promise<void> => {
  const matchingStatus = await tenantDb(knex, tenant).table('statuses')
    .where({
      board_id: boardId,
      status_id: statusId,
      status_type: 'ticket',
    })
    .first('status_id');

  if (!matchingStatus) {
    expectedInboundTicketDefaultsError('Selected status is not valid for the selected board');
  }
};

export const getInboundTicketDefaults = withAuth(async (
  _user,
  { tenant }
): Promise<{ defaults: InboundTicketDefaults[]; error?: string }> => {
  const { knex } = await createTenantKnex();
  
  try {
    const defaults = await tenantDb(knex, tenant).table('inbound_ticket_defaults')
      .orderBy('created_at', 'desc')
      .select(
        'id',
        'tenant',
        'short_name',
        'display_name',
        'description',
        'board_id',
        'status_id',
        'priority_id',
        'client_id',
        'entered_by',
        'category_id',
        'subcategory_id',
        'location_id',
        'is_active',
        'created_at',
        'updated_at'
      );

    return { defaults };
  } catch (error) {
    console.error('Failed to load inbound ticket defaults:', error);
    return {
      defaults: [],
      error: 'Failed to load inbound ticket defaults. Please try again.'
    };
  }
});

export const createInboundTicketDefaults = withAuth(async (
  _user,
  { tenant },
  data: {
    short_name: string;
    display_name: string;
    description?: string;
    board_id?: string;
    status_id?: string;
    priority_id?: string;
    client_id?: string;
    entered_by?: string | null;
    category_id?: string;
    subcategory_id?: string;
    location_id?: string | null;
    is_active?: boolean;
  }
): Promise<{ defaults: InboundTicketDefaults } | InboundTicketDefaultsActionError> => {
  const { knex } = await createTenantKnex();
  
  try {
    // Validate required defaults fields
    if (!data.board_id || !data.status_id || !data.priority_id) {
      expectedInboundTicketDefaultsError('Board, status, and priority are required');
    }

    await assertTicketStatusBelongsToBoard(knex, tenant, data.board_id, data.status_id);

    const locationId = data.location_id || null;
    if (locationId) {
      await assertLocationBelongsToClient(knex, tenant, data.client_id, locationId);
    }

    const [defaults] = await tenantDb(knex, tenant).table('inbound_ticket_defaults')
      .insert({
        id: knex.raw('gen_random_uuid()'),
        tenant,
        short_name: data.short_name,
        display_name: data.display_name,
        description: data.description,
        board_id: data.board_id,
        status_id: data.status_id,
        priority_id: data.priority_id,
        client_id: data.client_id,
        entered_by: data.entered_by,
        category_id: normalizeUuid(data.category_id),
        subcategory_id: normalizeUuid(data.subcategory_id),
        location_id: locationId,
        is_active: data.is_active ?? true,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      })
      .returning([
        'id',
        'tenant',
        'short_name',
        'display_name',
        'description',
        'board_id',
        'status_id',
        'priority_id',
        'client_id',
        'entered_by',
        'category_id',
        'subcategory_id',
        'location_id',
        'is_active',
        'created_at',
        'updated_at'
      ]);

    return { defaults };
  } catch (error) {
    if (error instanceof ExpectedInboundTicketDefaultsError) {
      return actionError(error.message, error.messageKey);
    }
    if (error instanceof Error && error.message.includes('unique')) {
      return actionError('A configuration with this short name already exists', 'msp/email-providers:errors.inboundDefaults.duplicateShortName');
    }
    console.error('Unexpected failure while creating inbound ticket defaults:', error);
    return actionError('Failed to create inbound ticket defaults. Please try again.', 'msp/email-providers:errors.inboundDefaults.createFailed');
  }
});

export const updateInboundTicketDefaults = withAuth(async (
  _user,
  { tenant },
  id: string,
  data: {
    short_name?: string;
    display_name?: string;
    description?: string;
    board_id?: string;
    status_id?: string;
    priority_id?: string;
    client_id?: string;
    entered_by?: string | null;
    category_id?: string;
    subcategory_id?: string;
    location_id?: string | null;
    is_active?: boolean;
  }
): Promise<{ defaults: InboundTicketDefaults } | InboundTicketDefaultsActionError> => {
  const { knex } = await createTenantKnex();
  
  try {
    const current = await tenantDb(knex, tenant).table('inbound_ticket_defaults')
      .where({ id })
      .select('board_id', 'status_id', 'priority_id', 'client_id', 'location_id')
      .first();

    if (!current) {
      return actionError('Defaults configuration not found', 'msp/email-providers:errors.inboundDefaults.notFound');
    }

    // If updating defaults, validate required fields
    if (data.board_id !== undefined || data.status_id !== undefined || data.priority_id !== undefined) {
      const finalBoardId = data.board_id !== undefined ? data.board_id : current?.board_id;
      const finalStatusId = data.status_id !== undefined ? data.status_id : current?.status_id;
      const finalPriorityId = data.priority_id !== undefined ? data.priority_id : current?.priority_id;
      
      if (!finalBoardId || !finalStatusId || !finalPriorityId) {
        expectedInboundTicketDefaultsError('Board, status, and priority are required');
      }

      await assertTicketStatusBelongsToBoard(knex, tenant, finalBoardId, finalStatusId);
    }

    const finalClientId = data.client_id !== undefined ? data.client_id : current.client_id;
    const clientChanged = data.client_id !== undefined && data.client_id !== current.client_id;
    // undefined = leave untouched; null = clear. A client change drops the old
    // client's location unless the caller explicitly supplies a new one.
    let finalLocationId: string | null | undefined;
    if (data.location_id !== undefined) {
      finalLocationId = data.location_id || null;
    } else if (clientChanged) {
      finalLocationId = null;
    }
    if (finalLocationId) {
      await assertLocationBelongsToClient(knex, tenant, finalClientId, finalLocationId);
    }

    const updateData: any = {
      updated_at: knex.fn.now()
    };

    if (data.short_name !== undefined) updateData.short_name = data.short_name;
    if (data.display_name !== undefined) updateData.display_name = data.display_name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.board_id !== undefined) updateData.board_id = data.board_id;
    if (data.status_id !== undefined) updateData.status_id = data.status_id;
    if (data.priority_id !== undefined) updateData.priority_id = data.priority_id;
    if (data.client_id !== undefined) updateData.client_id = data.client_id;
    if (data.entered_by !== undefined) updateData.entered_by = data.entered_by;
    if (data.category_id !== undefined) updateData.category_id = normalizeUuid(data.category_id);
    if (data.subcategory_id !== undefined) updateData.subcategory_id = normalizeUuid(data.subcategory_id);
    if (finalLocationId !== undefined) updateData.location_id = finalLocationId;
    if (data.is_active !== undefined) updateData.is_active = data.is_active;

    const [defaults] = await tenantDb(knex, tenant).table('inbound_ticket_defaults')
      .where({ id })
      .update(updateData)
      .returning([
        'id',
        'tenant',
        'short_name',
        'display_name',
        'description',
        'board_id',
        'status_id',
        'priority_id',
        'client_id',
        'entered_by',
        'category_id',
        'subcategory_id',
        'location_id',
        'is_active',
        'created_at',
        'updated_at'
      ]);

    if (!defaults) {
      return actionError('Defaults configuration not found', 'msp/email-providers:errors.inboundDefaults.notFound');
    }

    return { defaults };
  } catch (error) {
    if (error instanceof ExpectedInboundTicketDefaultsError) {
      return actionError(error.message, error.messageKey);
    }
    if (error instanceof Error && error.message.includes('unique')) {
      return actionError('A configuration with this short name already exists', 'msp/email-providers:errors.inboundDefaults.duplicateShortName');
    }
    console.error('Unexpected failure while updating inbound ticket defaults:', error);
    return actionError('Failed to update inbound ticket defaults. Please try again.', 'msp/email-providers:errors.inboundDefaults.updateFailed');
  }
});

export const deleteInboundTicketDefaults = withAuth(async (
  _user,
  { tenant },
  id: string
): Promise<{ success: true } | InboundTicketDefaultsActionError> => {
  const { knex } = await createTenantKnex();
  
  const outcome = await knex.transaction<
    { referencingProviders: Array<{ provider_name: string | null; mailbox: string | null }> } | { deletedCount: number }
  >(async (trx) => {
    // A provider with no defaults silently skips every inbound email
    // (missing_defaults), so refuse to orphan one instead of nulling the link.
    const referencingProviders = await tenantDb(trx, tenant).table('email_providers')
      .where({ inbound_ticket_defaults_id: id })
      .select('provider_name', 'mailbox');

    if (referencingProviders.length > 0) {
      return { referencingProviders };
    }

    // Client/contact overrides fall back to the provider defaults, so clearing
    // them is safe.
    await tenantDb(trx, tenant).table('clients')
      .where({ inbound_ticket_defaults_id: id })
      .update({
        inbound_ticket_defaults_id: null,
        updated_at: trx.fn.now(),
      });

    await tenantDb(trx, tenant).table('contacts')
      .where({ inbound_ticket_defaults_id: id })
      .update({
        inbound_ticket_defaults_id: null,
        updated_at: trx.fn.now(),
      });

    const rowsDeleted = await tenantDb(trx, tenant).table('inbound_ticket_defaults')
      .where({ id })
      .delete();

    return { deletedCount: Number(rowsDeleted) };
  });

  if ('referencingProviders' in outcome) {
    const providers = outcome.referencingProviders
      .map((p) => p.provider_name || p.mailbox)
      .filter((name): name is string => Boolean(name))
      .join(', ');
    return actionError(
      `This configuration is still used by the following email providers: ${providers}. Select different inbound ticket defaults on those providers before deleting it.`,
      'msp/email-providers:errors.inboundDefaults.referencedByProviders',
      { providers }
    );
  }

  if (outcome.deletedCount === 0) {
    return actionError('Defaults configuration not found', 'msp/email-providers:errors.inboundDefaults.notFound');
  }

  return { success: true };
});

export const getInboundTicketDefaultsById = withAuth(async (
  _user,
  { tenant },
  id: string
): Promise<{ defaults: InboundTicketDefaults | null; error?: string }> => {
  const { knex } = await createTenantKnex();
  
  try {
    const defaults = await tenantDb(knex, tenant).table('inbound_ticket_defaults')
      .where({ id })
      .select(
        'id',
        'tenant',
        'short_name',
        'display_name',
        'description',
        'defaults',
        'is_active',
        'created_at',
        'updated_at'
      )
      .first();

    return { defaults: defaults || null };
  } catch (error) {
    console.error('Failed to load inbound ticket defaults:', error);
    return {
      defaults: null,
      error: 'Failed to load inbound ticket defaults. Please try again.'
    };
  }
});
