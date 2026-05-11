import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { TicketModel, type CreateTicketInput } from '@alga-psa/shared/models/ticketModel';

import { registerAction, type InboundActionDefinition } from '@/lib/inboundWebhooks/actions/registry';
import { writeEntityMapping } from '@/lib/inboundWebhooks/externalEntityMappings';

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
        await trx('asset_associations').insert({
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

registerAction(createTicketAction);

export const ticketInboundActions = [createTicketAction];
