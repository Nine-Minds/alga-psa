import { describe, expect, it } from 'vitest';
import { buildWorkflowPayload } from '@shared/workflow/streams/workflowEventPublishHelpers';
import {
  invoiceDueDateChangedEventPayloadSchema,
  invoiceOverdueEventPayloadSchema,
  invoiceSentEventPayloadSchema,
  invoiceStatusChangedEventPayloadSchema,
  invoiceWrittenOffEventPayloadSchema,
} from '@shared/workflow/runtime/schemas/billingEventSchemas';
import {
  buildInvoiceDueDateChangedPayload,
  buildInvoiceOverduePayload,
  buildInvoiceSentPayload,
  buildInvoiceStatusChangedPayload,
  buildInvoiceWrittenOffPayload,
  inferInvoiceDeliveryMethod,
  toIsoDateString,
} from '../../lib/api/services/invoiceWorkflowEvents';

const TENANT_ID = '00000000-0000-0000-0000-000000000000';
const INVOICE_ID = '11111111-1111-1111-1111-111111111111';
const CLIENT_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

describe('invoice workflow event payload builders', () => {
  it('infers delivery method', () => {
    expect(inferInvoiceDeliveryMethod({ emailRecipientCount: 1 })).toBe('email');
    expect(inferInvoiceDeliveryMethod({ emailRecipientCount: 0, includePdf: true })).toBe('print');
    expect(inferInvoiceDeliveryMethod({ emailRecipientCount: 0, includePdf: false })).toBe('portal');
  });

  it('normalizes date values to ISO date strings', () => {
    expect(toIsoDateString('2026-01-23')).toBe('2026-01-23');
    expect(toIsoDateString('2026-01-23T12:00:00.000Z')).toBe('2026-01-23');
    expect(toIsoDateString(new Date('2026-01-23T12:00:00.000Z'))).toBe('2026-01-23');
  });

  it('builds INVOICE_SENT payloads that validate', () => {
    const sentAt = '2026-01-23T12:00:00.000Z';
    const payload = buildInvoiceSentPayload({
      invoiceId: INVOICE_ID,
      clientId: CLIENT_ID,
      sentByUserId: USER_ID,
      sentAt,
      deliveryMethod: 'email',
    });

    invoiceSentEventPayloadSchema.parse(
      buildWorkflowPayload(payload as any, {
        tenantId: TENANT_ID,
        occurredAt: sentAt,
        actor: { actorType: 'USER', actorUserId: USER_ID },
      })
    );
  });

  it('builds INVOICE_STATUS_CHANGED and INVOICE_DUE_DATE_CHANGED payloads that validate', () => {
    const changedAt = '2026-01-23T12:00:00.000Z';

    invoiceStatusChangedEventPayloadSchema.parse(
      buildWorkflowPayload(
        buildInvoiceStatusChangedPayload({
          invoiceId: INVOICE_ID,
          previousStatus: 'draft',
          newStatus: 'sent',
          changedAt,
        }) as any,
        { tenantId: TENANT_ID, occurredAt: changedAt, actor: { actorType: 'USER', actorUserId: USER_ID } }
      )
    );

    invoiceDueDateChangedEventPayloadSchema.parse(
      buildWorkflowPayload(
        buildInvoiceDueDateChangedPayload({
          invoiceId: INVOICE_ID,
          previousDueDate: '2026-01-20',
          newDueDate: '2026-01-25',
          changedAt,
        }) as any,
        { tenantId: TENANT_ID, occurredAt: changedAt, actor: { actorType: 'USER', actorUserId: USER_ID } }
      )
    );
  });

  it('builds INVOICE_OVERDUE payloads with computed daysOverdue', () => {
    const overdueAt = '2026-01-23T12:00:00.000Z';
    const payload = buildInvoiceOverduePayload({
      invoiceId: INVOICE_ID,
      clientId: CLIENT_ID,
      overdueAt,
      dueDate: '2026-01-20',
      amountDue: 12345,
      currency: 'USD',
    });

    expect(payload.daysOverdue).toBe(3);

    invoiceOverdueEventPayloadSchema.parse(
      buildWorkflowPayload(payload as any, {
        tenantId: TENANT_ID,
        occurredAt: overdueAt,
        actor: { actorType: 'USER', actorUserId: USER_ID },
      })
    );
  });

  it('builds INVOICE_WRITTEN_OFF payloads that validate', () => {
    const writtenOffAt = '2026-01-23T12:00:00.000Z';
    const payload = buildInvoiceWrittenOffPayload({
      invoiceId: INVOICE_ID,
      writtenOffAt,
      amountWrittenOff: 5000,
      currency: 'USD',
      reason: 'uncollectible',
    });

    invoiceWrittenOffEventPayloadSchema.parse(
      buildWorkflowPayload(payload as any, {
        tenantId: TENANT_ID,
        occurredAt: writtenOffAt,
        actor: { actorType: 'USER', actorUserId: USER_ID },
      })
    );
  });
});

