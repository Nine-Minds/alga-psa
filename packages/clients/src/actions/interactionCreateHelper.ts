// Internal server-side helpers. Callers must enforce auth/RBAC before invoking.
import { revalidatePath } from 'next/cache';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IInteraction } from '@alga-psa/types';
import { publishEvent, publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildInteractionLoggedPayload } from '@alga-psa/workflow-streams';
import InteractionModel from '../models/interactions';

type InteractionInput = Partial<IInteraction> & {
  type_id: string;
  title: string;
  user_id: string;
};

export interface CreateInteractionRecordParams {
  tenant: string;
  trx: Knex.Transaction;
  interactionData: InteractionInput;
}

export interface PublishInteractionSideEffectsParams {
  tenant: string;
  user?: unknown;
  interaction: IInteraction;
  changedFields?: string[];
}

export interface CreateInteractionWithSideEffectsParams extends CreateInteractionRecordParams {
  user?: unknown;
  changedFields?: string[];
}

function maybeUserActor(user: any) {
  const userId = user?.user_id;
  if (typeof userId !== 'string' || !userId) return undefined;
  return { actorType: 'USER' as const, actorUserId: userId };
}

export async function getDefaultInteractionStatusId(trx: Knex.Transaction, tenant: string): Promise<string> {
  const defaultStatus = await tenantDb(trx, tenant).table('statuses')
    .where({
      is_default: true,
      status_type: 'interaction'
    })
    .first();

  if (!defaultStatus) {
    throw new Error('No default status found for interactions');
  }

  return defaultStatus.status_id;
}

export async function publishInteractionSearchEvent(
  eventType: 'INTERACTION_CREATED' | 'INTERACTION_UPDATED' | 'INTERACTION_DELETED',
  tenant: string,
  interactionId: string,
  options: {
    clientId?: string | null;
    contactId?: string | null;
    userId?: string | null;
    changedFields?: string[];
  } = {},
): Promise<void> {
  try {
    await publishEvent({
      eventType,
      payload: {
        tenantId: tenant,
        interactionId,
        clientId: options.clientId ?? undefined,
        contactId: options.contactId ?? undefined,
        userId: options.userId ?? undefined,
        changedFields: options.changedFields,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (eventError) {
    console.error(`[interactionCreateHelper] Failed to publish ${eventType} search event:`, eventError);
  }
}

export async function createInteractionRecord({
  tenant,
  trx,
  interactionData,
}: CreateInteractionRecordParams): Promise<IInteraction> {
  if (!interactionData.user_id) {
    throw new Error('User ID is missing');
  }

  if (!interactionData.client_id && !interactionData.contact_name_id) {
    throw new Error('Either client_id or contact_name_id must be provided');
  }

  const status_id = interactionData.status_id || await getDefaultInteractionStatusId(trx, tenant);

  let resolvedClientId = interactionData.client_id;
  if (!resolvedClientId && interactionData.contact_name_id) {
    const contact = await tenantDb(trx, tenant).table('contacts')
      .where({ contact_name_id: interactionData.contact_name_id })
      .select('client_id')
      .first();
    resolvedClientId = contact?.client_id ?? null;
  }

  if (!resolvedClientId) {
    throw new Error('Interactions must be linked to a client');
  }

  const { interaction_id: _ignoredInteractionId, ...insertData } = interactionData;

  if (interactionData.opportunity_id) {
    const opportunity = await tenantDb(trx, tenant).table('opportunities')
      .where({ opportunity_id: interactionData.opportunity_id })
      .select('client_id')
      .first();
    if (!opportunity || opportunity.client_id !== resolvedClientId) {
      throw new Error('Opportunity not found for interaction client');
    }
  }

  const interaction = await InteractionModel.addInteraction({
    ...insertData,
    client_id: resolvedClientId,
    status_id,
    tenant,
    interaction_date: interactionData.interaction_date ?? new Date(),
  } as Omit<IInteraction, 'interaction_id'>, tenant, trx);

  if (interaction.opportunity_id) {
    const activityAt = interaction.interaction_date instanceof Date
      ? interaction.interaction_date.toISOString()
      : new Date(interaction.interaction_date).toISOString();
    await tenantDb(trx, tenant).table('opportunities')
      .where({ opportunity_id: interaction.opportunity_id })
      .update({ last_activity_at: activityAt, updated_at: new Date().toISOString() });
  }

  return interaction;
}

export async function publishInteractionCreatedSideEffects({
  tenant,
  user,
  interaction,
  changedFields = ['title', 'notes', 'client_id', 'contact_name_id', 'ticket_id', 'opportunity_id'],
}: PublishInteractionSideEffectsParams): Promise<void> {
  const occurredAt =
    interaction.interaction_date instanceof Date
      ? interaction.interaction_date.toISOString()
      : new Date(interaction.interaction_date as any).toISOString();

  const interactionType =
    typeof (interaction as any).type_name === 'string' && (interaction as any).type_name
      ? String((interaction as any).type_name)
      : 'interaction';

  await publishWorkflowEvent({
    eventType: 'INTERACTION_LOGGED',
    payload: buildInteractionLoggedPayload({
      interactionId: interaction.interaction_id,
      clientId: interaction.client_id as string,
      ...(interaction.contact_name_id ? { contactId: interaction.contact_name_id } : {}),
      interactionType,
      interactionOccurredAt: occurredAt,
      loggedByUserId: interaction.user_id,
      ...(typeof interaction.title === 'string' && interaction.title ? { subject: interaction.title } : {}),
      ...(typeof (interaction as any).status_name === 'string' && (interaction as any).status_name
        ? { outcome: String((interaction as any).status_name) }
        : {}),
    }),
    ctx: { tenantId: tenant, occurredAt, actor: maybeUserActor(user) },
    idempotencyKey: `interaction_logged:${interaction.interaction_id}:${occurredAt}`,
  });

  await publishInteractionSearchEvent('INTERACTION_CREATED', tenant, interaction.interaction_id, {
    clientId: interaction.client_id,
    contactId: interaction.contact_name_id,
    userId: interaction.user_id,
    changedFields,
  });

  revalidatePath('/msp/contacts/[id]', 'page');
  revalidatePath('/msp/clients/[id]', 'page');
}

export async function createInteractionWithSideEffects(
  params: CreateInteractionWithSideEffectsParams,
): Promise<{ interaction: IInteraction; publishSideEffects: () => Promise<void> }> {
  const interaction = await createInteractionRecord(params);

  return {
    interaction,
    publishSideEffects: () => publishInteractionCreatedSideEffects({
      tenant: params.tenant,
      user: params.user,
      interaction,
      changedFields: params.changedFields,
    }),
  };
}
