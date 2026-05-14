import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { InvoiceStatus } from '@alga-psa/types';

import { registerAction, type InboundActionDefinition } from '@alga-psa/shared/inboundWebhooks/actions/registry';
import { lookupAlgaEntityByExternalId } from '@alga-psa/shared/inboundWebhooks/externalEntityMappings';

interface MarkInvoicePaidByExternalIdMappedValues extends Record<string, unknown> {
  external_id: string;
  paid_at?: string;
  payment_reference?: string;
}

interface UpdateInvoiceStatusByExternalIdMappedValues extends Record<string, unknown> {
  external_id: string;
  status: InvoiceStatus;
}

const invoiceStatusValues: InvoiceStatus[] = [
  'draft',
  'sent',
  'paid',
  'overdue',
  'cancelled',
  'pending',
  'prepayment',
  'partially_applied',
];

const markInvoicePaidByExternalIdAction: InboundActionDefinition<MarkInvoicePaidByExternalIdMappedValues> = {
  name: 'markInvoicePaidByExternalId',
  entityType: 'invoice',
  displayName: 'Mark Invoice Paid by External ID',
  description: 'Mark a mapped invoice as paid using the webhook-scoped external ID.',
  targetFields: [
    { name: 'external_id', type: 'string', required: true, description: 'External invoice identifier to resolve' },
    { name: 'paid_at', type: 'string', required: false, description: 'Payment timestamp' },
    { name: 'payment_reference', type: 'string', required: false, description: 'External payment reference' },
  ],
  async handle(ctx, mappedValues) {
    const invoice = await updateMappedInvoice(ctx.tenant, ctx.webhookSlug, mappedValues.external_id, {
      status: 'paid',
      custom_fields_patch: {
        inbound_webhook_paid_at: mappedValues.paid_at ?? new Date().toISOString(),
        inbound_webhook_payment_reference: mappedValues.payment_reference ?? null,
        inbound_webhook_delivery_id: ctx.deliveryId,
      },
    });

    if (!invoice) {
      return lookupMiss(ctx.webhookSlug, mappedValues.external_id);
    }

    return {
      success: true,
      entityType: 'invoice',
      entityId: invoice.invoice_id,
      externalId: mappedValues.external_id,
      metadata: {
        status: invoice.status,
      },
    };
  },
};

const updateInvoiceStatusByExternalIdAction: InboundActionDefinition<UpdateInvoiceStatusByExternalIdMappedValues> = {
  name: 'updateInvoiceStatusByExternalId',
  entityType: 'invoice',
  displayName: 'Update Invoice Status by External ID',
  description: 'Update a mapped invoice status using the webhook-scoped external ID.',
  targetFields: [
    { name: 'external_id', type: 'string', required: true, description: 'External invoice identifier to resolve' },
    {
      name: 'status',
      type: 'enum',
      required: true,
      description: 'Target invoice status',
      enumValues: invoiceStatusValues,
    },
  ],
  async handle(ctx, mappedValues) {
    const invoice = await updateMappedInvoice(ctx.tenant, ctx.webhookSlug, mappedValues.external_id, {
      status: mappedValues.status,
      custom_fields_patch: {
        inbound_webhook_status_delivery_id: ctx.deliveryId,
      },
    });

    if (!invoice) {
      return lookupMiss(ctx.webhookSlug, mappedValues.external_id);
    }

    return {
      success: true,
      entityType: 'invoice',
      entityId: invoice.invoice_id,
      externalId: mappedValues.external_id,
      metadata: {
        status: invoice.status,
      },
    };
  },
};

registerAction(markInvoicePaidByExternalIdAction);
registerAction(updateInvoiceStatusByExternalIdAction);

export const invoiceInboundActions = [markInvoicePaidByExternalIdAction, updateInvoiceStatusByExternalIdAction];

async function updateMappedInvoice(
  tenant: string,
  webhookSlug: string,
  externalId: string,
  input: { status: InvoiceStatus; custom_fields_patch: Record<string, unknown> },
): Promise<{ invoice_id: string; status: string } | null> {
  const { knex } = await createTenantKnex(tenant);

  return withTransaction(knex, async (trx) => {
    const lookup = await lookupAlgaEntityByExternalId(tenant, webhookSlug, 'invoice', externalId, { knex: trx });
    if (!lookup) {
      return null;
    }

    const current = await trx('invoices')
      .where({ tenant, invoice_id: lookup.algaEntityId })
      .first<{ invoice_id: string; status: string; custom_fields: Record<string, unknown> | null }>();

    if (!current) {
      return null;
    }

    if (current.status === input.status) {
      return current;
    }

    const [updated] = await trx('invoices')
      .where({ tenant, invoice_id: lookup.algaEntityId })
      .update({
        status: input.status,
        custom_fields: {
          ...(current.custom_fields ?? {}),
          ...input.custom_fields_patch,
        },
        updated_at: trx.fn.now(),
      })
      .returning<{ invoice_id: string; status: string }[]>(['invoice_id', 'status']);

    return updated ?? null;
  });
}

function lookupMiss(webhookSlug: string, externalId: string) {
  return {
    success: false,
    entityType: 'invoice',
    externalId,
    message: `lookup_miss: invoice external_id "${externalId}" is not mapped for webhook "${webhookSlug}"`,
  };
}
