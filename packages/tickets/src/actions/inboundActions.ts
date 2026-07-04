import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import {
  TicketModel,
  type CreateCommentInput,
  type CreateTicketInput,
  type UpdateTicketInput,
} from '@alga-psa/shared/models/ticketModel';

import { registerAction, type InboundActionDefinition } from '@alga-psa/shared/inboundWebhooks/actions/registry';
import { lookupAlgaEntityByExternalId, writeEntityMapping } from '@alga-psa/shared/inboundWebhooks/externalEntityMappings';

interface CreateTicketMappedValues extends Record<string, unknown> {
  title: string;
  description?: string;
  client_id: string;
  board_id: string;
  status_id?: string;
  priority_id: string;
  assigned_to?: string;
  assigned_team_id?: string;
  category_id?: string;
  subcategory_id?: string;
  contact_id?: string;
  location_id?: string;
  due_date?: string;
  asset_id?: string;
  external_id?: string;
  attributes?: Record<string, unknown>;
}

interface UpdateTicketByExternalIdMappedValues extends Record<string, unknown> {
  external_id: string;
  title?: string;
  client_id?: string;
  board_id?: string;
  status_id?: string;
  priority_id?: string;
  assigned_to?: string;
  assigned_team_id?: string;
  category_id?: string;
  subcategory_id?: string;
  contact_id?: string;
  location_id?: string;
  due_date?: string;
  attributes?: Record<string, unknown>;
}

interface AddTicketCommentByExternalIdMappedValues extends Record<string, unknown> {
  external_id: string;
  content: string;
  is_internal?: boolean;
  is_resolution?: boolean;
  author_id?: string;
  contact_id?: string;
}

interface ChangeTicketStatusByExternalIdMappedValues extends Record<string, unknown> {
  external_id: string;
  status_id: string;
  board_id?: string;
}

const createTicketAction: InboundActionDefinition<CreateTicketMappedValues> = {
  name: 'createTicket',
  entityType: 'ticket',
  displayName: 'Create Ticket',
  description: 'Create a ticket from an inbound webhook payload.',
  targetFields: [
    { name: 'title', type: 'string', required: true, description: 'Ticket title' },
    { name: 'description', type: 'string', required: false, description: 'Ticket description' },
    { name: 'client_id', type: 'ref', required: true, refEntityType: 'client', description: 'Client ID' },
    { name: 'board_id', type: 'ref', required: true, refEntityType: 'board', description: 'Ticket board ID' },
    { name: 'status_id', type: 'ref', required: false, refEntityType: 'ticket_status', description: 'Ticket status ID' },
    { name: 'priority_id', type: 'ref', required: true, refEntityType: 'ticket_priority', description: 'Ticket priority ID' },
    { name: 'assigned_to', type: 'ref', required: false, refEntityType: 'user', description: 'Assigned user ID' },
    { name: 'assigned_team_id', type: 'ref', required: false, refEntityType: 'team', description: 'Assigned team ID' },
    { name: 'category_id', type: 'ref', required: false, refEntityType: 'ticket_category', description: 'Category ID' },
    { name: 'subcategory_id', type: 'ref', required: false, refEntityType: 'ticket_subcategory', description: 'Subcategory ID' },
    { name: 'contact_id', type: 'ref', required: false, refEntityType: 'contact', description: 'Contact ID' },
    { name: 'location_id', type: 'ref', required: false, refEntityType: 'client_location', description: 'Location ID' },
    { name: 'due_date', type: 'string', required: false, description: 'Due date' },
    { name: 'asset_id', type: 'ref', required: false, refEntityType: 'asset', description: 'Affected asset ID' },
    { name: 'external_id', type: 'string', required: false, description: 'External ticket identifier to map' },
    { name: 'attributes', type: 'json', required: false, description: 'Additional ticket attributes' },
  ],
  async handle(ctx, mappedValues) {
    const { knex } = await createTenantKnex(ctx.tenant);
    const ticket = await withTransaction(knex, async (trx) => {
      const input: CreateTicketInput = {
        title: mappedValues.title,
        description: mappedValues.description,
        client_id: mappedValues.client_id,
        board_id: mappedValues.board_id,
        status_id: mappedValues.status_id,
        priority_id: mappedValues.priority_id,
        assigned_to: mappedValues.assigned_to,
        assigned_team_id: mappedValues.assigned_team_id,
        category_id: mappedValues.category_id,
        subcategory_id: mappedValues.subcategory_id,
        contact_id: mappedValues.contact_id,
        location_id: mappedValues.location_id,
        due_date: mappedValues.due_date,
        attributes: {
          ...(mappedValues.attributes ?? {}),
          inbound_webhook_delivery_id: ctx.deliveryId,
          inbound_webhook_slug: ctx.webhookSlug,
        },
        source: 'webhook',
        ticket_origin: 'api',
      };

      const created = await TicketModel.createTicketWithRetry(input, ctx.tenant, trx, {}, undefined, undefined, undefined, 3);

      if (mappedValues.asset_id) {
        await tenantDb(trx, ctx.tenant).table('asset_associations').insert({
          tenant: ctx.tenant,
          asset_id: mappedValues.asset_id,
          entity_id: created.ticket_id,
          entity_type: 'ticket',
          relationship_type: 'affected',
          created_at: new Date().toISOString(),
        });
      }

      if (mappedValues.external_id) {
        await writeEntityMapping(ctx.tenant, ctx.webhookSlug, 'ticket', created.ticket_id, mappedValues.external_id, {
          knex: trx,
          metadata: { source: 'inbound_webhook', delivery_id: ctx.deliveryId },
        });
      }

      return created;
    });

    return {
      success: true,
      entityType: 'ticket',
      entityId: ticket.ticket_id,
      externalId: mappedValues.external_id,
      metadata: {
        ticket_number: ticket.ticket_number,
      },
    };
  },
};

const updateTicketByExternalIdAction: InboundActionDefinition<UpdateTicketByExternalIdMappedValues> = {
  name: 'updateTicketByExternalId',
  entityType: 'ticket',
  displayName: 'Update Ticket by External ID',
  description: 'Update a mapped ticket using the webhook-scoped external ID.',
  targetFields: [
    { name: 'external_id', type: 'string', required: true, description: 'External ticket identifier to resolve' },
    { name: 'title', type: 'string', required: false, description: 'Ticket title' },
    { name: 'client_id', type: 'ref', required: false, refEntityType: 'client', description: 'Client ID' },
    { name: 'board_id', type: 'ref', required: false, refEntityType: 'board', description: 'Ticket board ID' },
    { name: 'status_id', type: 'ref', required: false, refEntityType: 'ticket_status', description: 'Ticket status ID' },
    { name: 'priority_id', type: 'ref', required: false, refEntityType: 'ticket_priority', description: 'Ticket priority ID' },
    { name: 'assigned_to', type: 'ref', required: false, refEntityType: 'user', description: 'Assigned user ID' },
    { name: 'assigned_team_id', type: 'ref', required: false, refEntityType: 'team', description: 'Assigned team ID' },
    { name: 'category_id', type: 'ref', required: false, refEntityType: 'ticket_category', description: 'Category ID' },
    { name: 'subcategory_id', type: 'ref', required: false, refEntityType: 'ticket_subcategory', description: 'Subcategory ID' },
    { name: 'contact_id', type: 'ref', required: false, refEntityType: 'contact', description: 'Contact ID' },
    { name: 'location_id', type: 'ref', required: false, refEntityType: 'client_location', description: 'Location ID' },
    { name: 'due_date', type: 'string', required: false, description: 'Due date' },
    { name: 'attributes', type: 'json', required: false, description: 'Additional ticket attributes to merge' },
  ],
  async handle(ctx, mappedValues) {
    const { knex } = await createTenantKnex(ctx.tenant);
    const updatedTicket = await withTransaction(knex, async (trx) => {
      const lookup = await lookupAlgaEntityByExternalId(
        ctx.tenant,
        ctx.webhookSlug,
        'ticket',
        mappedValues.external_id,
        { knex: trx },
      );

      if (!lookup) {
        return null;
      }

      const updateInput: UpdateTicketInput = {};
      assignIfPresent(updateInput, 'title', mappedValues.title);
      assignIfPresent(updateInput, 'client_id', mappedValues.client_id);
      assignIfPresent(updateInput, 'board_id', mappedValues.board_id);
      assignIfPresent(updateInput, 'status_id', mappedValues.status_id);
      assignIfPresent(updateInput, 'priority_id', mappedValues.priority_id);
      assignIfPresent(updateInput, 'assigned_to', mappedValues.assigned_to);
      assignIfPresent(updateInput, 'assigned_team_id', mappedValues.assigned_team_id);
      assignIfPresent(updateInput, 'category_id', mappedValues.category_id);
      assignIfPresent(updateInput, 'subcategory_id', mappedValues.subcategory_id);
      assignIfPresent(updateInput, 'contact_name_id', mappedValues.contact_id);
      assignIfPresent(updateInput, 'location_id', mappedValues.location_id);
      assignIfPresent(updateInput, 'due_date', mappedValues.due_date);
      if (mappedValues.attributes) {
        updateInput.attributes = {
          ...mappedValues.attributes,
          inbound_webhook_delivery_id: ctx.deliveryId,
          inbound_webhook_slug: ctx.webhookSlug,
        };
      }

      return TicketModel.updateTicket(lookup.algaEntityId, updateInput, ctx.tenant, trx);
    });

    if (!updatedTicket) {
      return {
        success: false,
        entityType: 'ticket',
        externalId: mappedValues.external_id,
        message: `lookup_miss: ticket external_id "${mappedValues.external_id}" is not mapped for webhook "${ctx.webhookSlug}"`,
      };
    }

    return {
      success: true,
      entityType: 'ticket',
      entityId: updatedTicket.ticket_id,
      externalId: mappedValues.external_id,
      metadata: {
        updated_fields: Object.keys(mappedValues).filter((field) => field !== 'external_id'),
      },
    };
  },
};

const addTicketCommentByExternalIdAction: InboundActionDefinition<AddTicketCommentByExternalIdMappedValues> = {
  name: 'addTicketCommentByExternalId',
  entityType: 'ticket',
  displayName: 'Add Ticket Comment by External ID',
  description: 'Append a comment to a mapped ticket using the webhook-scoped external ID.',
  targetFields: [
    { name: 'external_id', type: 'string', required: true, description: 'External ticket identifier to resolve' },
    { name: 'content', type: 'string', required: true, description: 'Comment content' },
    { name: 'is_internal', type: 'boolean', required: false, description: 'Whether the comment is internal only' },
    { name: 'is_resolution', type: 'boolean', required: false, description: 'Whether the comment is a resolution note' },
    { name: 'author_id', type: 'ref', required: false, refEntityType: 'user', description: 'Internal author user ID' },
    { name: 'contact_id', type: 'ref', required: false, refEntityType: 'contact', description: 'Contact author ID' },
  ],
  async handle(ctx, mappedValues) {
    if (mappedValues.author_id && mappedValues.contact_id) {
      throw new Error(
        'VALIDATION_ERROR: author_id and contact_id cannot both be set on a single comment',
      );
    }

    const { knex } = await createTenantKnex(ctx.tenant);
    const comment = await withTransaction(knex, async (trx) => {
      const lookup = await lookupAlgaEntityByExternalId(
        ctx.tenant,
        ctx.webhookSlug,
        'ticket',
        mappedValues.external_id,
        { knex: trx },
      );

      if (!lookup) {
        return null;
      }

      const input: CreateCommentInput = {
        ticket_id: lookup.algaEntityId,
        content: mappedValues.content,
        is_internal: mappedValues.is_internal ?? true,
        is_resolution: mappedValues.is_resolution ?? false,
        author_type: mappedValues.contact_id ? 'contact' : mappedValues.author_id ? 'internal' : 'system',
        author_id: mappedValues.author_id,
        contact_id: mappedValues.contact_id,
        metadata: {
          inbound_webhook_delivery_id: ctx.deliveryId,
          inbound_webhook_slug: ctx.webhookSlug,
          external_id: mappedValues.external_id,
        },
      };

      return TicketModel.createComment(input, ctx.tenant, trx);
    });

    if (!comment) {
      return {
        success: false,
        entityType: 'ticket',
        externalId: mappedValues.external_id,
        message: `lookup_miss: ticket external_id "${mappedValues.external_id}" is not mapped for webhook "${ctx.webhookSlug}"`,
      };
    }

    return {
      success: true,
      entityType: 'ticket',
      entityId: comment.ticket_id,
      externalId: mappedValues.external_id,
      metadata: {
        comment_id: comment.comment_id,
      },
    };
  },
};

const changeTicketStatusByExternalIdAction: InboundActionDefinition<ChangeTicketStatusByExternalIdMappedValues> = {
  name: 'changeTicketStatusByExternalId',
  entityType: 'ticket',
  displayName: 'Change Ticket Status by External ID',
  description: 'Change the status of a mapped ticket using the webhook-scoped external ID.',
  targetFields: [
    { name: 'external_id', type: 'string', required: true, description: 'External ticket identifier to resolve' },
    { name: 'status_id', type: 'ref', required: true, refEntityType: 'ticket_status', description: 'Target ticket status ID' },
    { name: 'board_id', type: 'ref', required: false, refEntityType: 'board', description: 'Destination board ID when moving boards' },
  ],
  async handle(ctx, mappedValues) {
    const { knex } = await createTenantKnex(ctx.tenant);
    const updatedTicket = await withTransaction(knex, async (trx) => {
      const lookup = await lookupAlgaEntityByExternalId(
        ctx.tenant,
        ctx.webhookSlug,
        'ticket',
        mappedValues.external_id,
        { knex: trx },
      );

      if (!lookup) {
        return null;
      }

      const updateInput: UpdateTicketInput = {
        status_id: mappedValues.status_id,
      };
      assignIfPresent(updateInput, 'board_id', mappedValues.board_id);

      return TicketModel.updateTicket(lookup.algaEntityId, updateInput, ctx.tenant, trx);
    });

    if (!updatedTicket) {
      return {
        success: false,
        entityType: 'ticket',
        externalId: mappedValues.external_id,
        message: `lookup_miss: ticket external_id "${mappedValues.external_id}" is not mapped for webhook "${ctx.webhookSlug}"`,
      };
    }

    return {
      success: true,
      entityType: 'ticket',
      entityId: updatedTicket.ticket_id,
      externalId: mappedValues.external_id,
      metadata: {
        status_id: updatedTicket.status_id,
      },
    };
  },
};

registerAction(createTicketAction);
registerAction(updateTicketByExternalIdAction);
registerAction(addTicketCommentByExternalIdAction);
registerAction(changeTicketStatusByExternalIdAction);

export const ticketInboundActions = [
  createTicketAction,
  updateTicketByExternalIdAction,
  addTicketCommentByExternalIdAction,
  changeTicketStatusByExternalIdAction,
];

function assignIfPresent<T extends object>(target: T, key: string, value: unknown): void {
  if (value !== undefined) {
    (target as Record<string, unknown>)[key] = value;
  }
}
