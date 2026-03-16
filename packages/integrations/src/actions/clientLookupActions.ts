'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { createDefaultTaxSettings } from '@alga-psa/shared/billingClients';
import {
  buildClientCreatedPayload,
} from '@alga-psa/workflow-streams';
import { ContactModel } from '@alga-psa/shared/models/contactModel';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import type { IClient, IContact } from '@alga-psa/types';
import type { Knex } from 'knex';

function maybeUserActor(currentUser: unknown) {
  const userId = (currentUser as { user_id?: string } | undefined)?.user_id;
  if (typeof userId !== 'string' || !userId) return undefined;
  return { actorType: 'USER' as const, actorUserId: userId };
}

function extractNameFromEmail(email: string): string {
  const localPart = email.split('@')[0];
  return localPart
    .replace(/[._-]/g, ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function buildDefaultPhoneNumbers(phone?: string) {
  const trimmedPhone = phone?.trim();
  if (!trimmedPhone) {
    return [];
  }

  return [{
    phone_number: trimmedPhone,
    canonical_type: 'work' as const,
    is_default: true,
    display_order: 0,
  }];
}

export const getIntegrationClients = withAuth(async (
  _user,
  { tenant },
  includeInactive: boolean = true
): Promise<IClient[]> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const query = trx('clients')
      .select('*')
      .where('tenant', tenant)
      .orderBy('client_name', 'asc');

    if (!includeInactive) {
      query.andWhere({ is_inactive: false });
    }

    return query;
  }) as unknown as IClient[];
});

export const findIntegrationContactByEmailAddress = withAuth(async (
  _user,
  { tenant },
  email: string
): Promise<(IContact & { client_name?: string | null }) | null> => {
  const { knex } = await createTenantKnex();

  const contact = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const baseContact = await trx('contacts')
      .select('contacts.*', 'clients.client_name')
      .leftJoin('clients', function joinClients() {
        this.on('contacts.client_id', '=', 'clients.client_id')
          .andOn('clients.tenant', '=', 'contacts.tenant');
      })
      .where({
        'contacts.email': email.toLowerCase(),
        'contacts.tenant': tenant,
      })
      .first();

    if (!baseContact) {
      return null;
    }

    const [hydratedContact] = await ContactModel.hydrateContactsWithPhoneNumbers([baseContact as any], tenant, trx);
    return {
      ...hydratedContact,
      client_name: (baseContact as { client_name?: string | null }).client_name ?? null,
    };
  });

  return (contact ?? null) as (IContact & { client_name?: string | null }) | null;
});

export const createOrFindIntegrationContactByEmail = withAuth(async (
  _user,
  { tenant },
  input: {
    email: string;
    name?: string;
    clientId: string;
    phone?: string;
    title?: string;
  }
): Promise<{ contact: IContact & { client_name: string }; isNew: boolean }> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const existingBaseContact = await trx('contacts')
      .select('contacts.*', 'clients.client_name')
      .leftJoin('clients', function joinClients() {
        this.on('contacts.client_id', '=', 'clients.client_id')
          .andOn('clients.tenant', '=', 'contacts.tenant');
      })
      .where({
        'contacts.email': input.email.toLowerCase(),
        'contacts.tenant': tenant,
      })
      .first();

    if (existingBaseContact) {
      if (existingBaseContact.client_id !== input.clientId) {
        if (!existingBaseContact.client_id) {
          throw new Error('EMAIL_EXISTS: A contact with this email address already exists in the system without a client assignment');
        }
        throw new Error(`EMAIL_EXISTS: This email is already associated with ${existingBaseContact.client_name || 'another client'}`);
      }

      const [existingContact] = await ContactModel.hydrateContactsWithPhoneNumbers([existingBaseContact as any], tenant, trx);

      return {
        contact: {
          ...(existingContact as IContact),
          client_name: existingBaseContact.client_name || '',
        },
        isNew: false,
      };
    }

    const newContact = await ContactModel.createContact({
      full_name: input.name || extractNameFromEmail(input.email),
      email: input.email.toLowerCase(),
      client_id: input.clientId,
      phone_numbers: buildDefaultPhoneNumbers(input.phone),
      role: input.title,
      is_inactive: false,
    }, tenant, trx);

    const client = await trx('clients')
      .select('client_name')
      .where({ client_id: input.clientId, tenant })
      .first();

    return {
      contact: {
        ...(newContact as IContact),
        client_name: client?.client_name || '',
      },
      isNew: true,
    };
  });
});

export const createIntegrationClient = withAuth(async (
  user,
  { tenant },
  client: Pick<IClient, 'client_name' | 'url' | 'properties' | 'is_inactive' | 'client_type' | 'account_manager_id'>
): Promise<{ success: true; data: IClient } | { success: false; error: string }> => {
  const canCreate = await hasPermission(user as any, 'client', 'create');
  if (!canCreate) {
    throw new Error('Permission denied: Cannot create clients');
  }

  const { knex } = await createTenantKnex();

  try {
    const clientData: Record<string, unknown> = { ...client };

    if ((clientData.properties as Record<string, unknown> | undefined)?.website && !clientData.url) {
      clientData.url = (clientData.properties as Record<string, string>).website;
    }

    if (clientData.url && (!(clientData.properties as Record<string, unknown> | undefined)?.website)) {
      clientData.properties = {
        ...((clientData.properties as Record<string, unknown> | undefined) || {}),
        website: clientData.url,
      };
    }

    const createdClient = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const [created] = await trx<IClient>('clients')
        .insert({
          ...clientData,
          tenant,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .returning('*');

      await createDefaultTaxSettings(trx, tenant, created.client_id);
      return created;
    });

    if (!createdClient) {
      throw new Error('Failed to create client');
    }

    const createdAt = createdClient.created_at ?? new Date().toISOString();
    const status =
      (createdClient as any)?.properties?.status ??
      (createdClient.is_inactive ? 'inactive' : 'active');

    await publishWorkflowEvent({
      eventType: 'CLIENT_CREATED',
      payload: buildClientCreatedPayload({
        clientId: createdClient.client_id,
        clientName: createdClient.client_name,
        createdByUserId: (user as { user_id?: string } | undefined)?.user_id,
        createdAt,
        status,
      }),
      ctx: {
        tenantId: tenant,
        occurredAt: createdAt,
        actor: maybeUserActor(user),
      },
      idempotencyKey: `client_created:${createdClient.client_id}`,
    });

    return { success: true, data: createdClient };
  } catch (error: any) {
    if (error.code === '23505') {
      if (error.constraint && error.constraint.includes('clients_tenant_client_name_unique')) {
        return { success: false, error: `A client with the name "${client.client_name}" already exists. Please choose a different name.` };
      }
      return { success: false, error: 'A client with these details already exists. Please check the client name.' };
    }

    if (error.code === '23514') {
      return { success: false, error: 'Invalid data provided. Please check all fields and try again.' };
    }

    if (error.code === '23503') {
      return { success: false, error: 'Referenced data not found. Please check account manager selection.' };
    }

    if (error.message && !error.code) {
      throw error;
    }

    throw new Error('Failed to create client. Please try again.');
  }
});
