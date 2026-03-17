import { z } from 'zod';
import { BaseDomainEventPayloadSchema, changesSchema, currencySchema, updatedFieldsSchema, uuidSchema } from './commonEventPayloadSchemas';

const invoiceIdSchema = uuidSchema('Invoice ID');
const paymentIdSchema = uuidSchema('Payment ID');
const creditNoteIdSchema = uuidSchema('Credit Note ID');
const contractIdSchema = uuidSchema('Contract ID');
const clientIdSchema = uuidSchema('Client ID');
const userIdSchema = uuidSchema('User ID');

const deliveryMethodSchema = z.enum(['email', 'portal', 'print']).describe('Invoice delivery method');
const invoiceRecurringProvenanceSchema = z.object({
  authoritativePeriodSource: z.enum(['canonical_detail_rows', 'parent_charge_fields']),
  detailBackedChargeCount: z.number().int().nonnegative(),
  detailPeriodCount: z.number().int().nonnegative(),
  summaryServicePeriodStart: z.string().datetime().nullable().optional(),
  summaryServicePeriodEnd: z.string().datetime().nullable().optional(),
  billingTimingShape: z.enum(['none', 'uniform', 'mixed']),
});
const recurringBillingRunSelectionModeSchema = z.enum(['due_service_periods']).describe('How recurring billing selected charge timing for the run');
const recurringBillingRunWindowIdentitySchema = z.enum(['billing_cycle_window']).describe('How the current recurring run identified invoice windows');
const recurringBillingRunExecutionWindowKindSchema = z
  .enum(['billing_cycle_window', 'contract_cadence_window'])
  .describe('Which recurring execution-window kinds the run was prepared to process');

export const invoiceGeneratedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  invoiceId: invoiceIdSchema,
  clientId: clientIdSchema.optional(),
  userId: userIdSchema.optional(),
  totalAmount: z.string().optional(),
  status: z.string().optional(),
  invoiceNumber: z.string().optional(),
  recurringProvenance: invoiceRecurringProvenanceSchema.optional(),
}).describe('Payload for INVOICE_GENERATED');

export type InvoiceGeneratedEventPayload = z.infer<typeof invoiceGeneratedEventPayloadSchema>;

export const invoiceFinalizedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  invoiceId: invoiceIdSchema,
  clientId: clientIdSchema.optional(),
  userId: userIdSchema.optional(),
  totalAmount: z.string().optional(),
  status: z.string().optional(),
  invoiceNumber: z.string().optional(),
  recurringProvenance: invoiceRecurringProvenanceSchema.optional(),
}).describe('Payload for INVOICE_FINALIZED');

export type InvoiceFinalizedEventPayload = z.infer<typeof invoiceFinalizedEventPayloadSchema>;

export const invoiceSentEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  invoiceId: invoiceIdSchema,
  clientId: clientIdSchema.optional(),
  sentByUserId: userIdSchema.optional(),
  sentAt: z.string().datetime().optional(),
  deliveryMethod: deliveryMethodSchema,
  recurringProvenance: invoiceRecurringProvenanceSchema.optional(),
}).describe('Payload for INVOICE_SENT');

export type InvoiceSentEventPayload = z.infer<typeof invoiceSentEventPayloadSchema>;

export const invoiceStatusChangedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  invoiceId: invoiceIdSchema,
  previousStatus: z.string().min(1),
  newStatus: z.string().min(1),
  changedAt: z.string().datetime().optional(),
  recurringProvenance: invoiceRecurringProvenanceSchema.optional(),
}).describe('Payload for INVOICE_STATUS_CHANGED');

export type InvoiceStatusChangedEventPayload = z.infer<typeof invoiceStatusChangedEventPayloadSchema>;

export const invoiceDueDateChangedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  invoiceId: invoiceIdSchema,
  previousDueDate: z.string().min(1),
  newDueDate: z.string().min(1),
  changedAt: z.string().datetime().optional(),
  recurringProvenance: invoiceRecurringProvenanceSchema.optional(),
}).describe('Payload for INVOICE_DUE_DATE_CHANGED');

export type InvoiceDueDateChangedEventPayload = z.infer<typeof invoiceDueDateChangedEventPayloadSchema>;

export const invoiceOverdueEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  invoiceId: invoiceIdSchema,
  clientId: clientIdSchema.optional(),
  overdueAt: z.string().datetime().optional(),
  dueDate: z.string().min(1),
  amountDue: z.string().min(1),
  currency: currencySchema,
  daysOverdue: z.number().int().nonnegative(),
  recurringProvenance: invoiceRecurringProvenanceSchema.optional(),
}).describe('Payload for INVOICE_OVERDUE');

export type InvoiceOverdueEventPayload = z.infer<typeof invoiceOverdueEventPayloadSchema>;

export const invoiceWrittenOffEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  invoiceId: invoiceIdSchema,
  writtenOffAt: z.string().datetime().optional(),
  amountWrittenOff: z.string().min(1),
  currency: currencySchema,
  reason: z.string().optional(),
  recurringProvenance: invoiceRecurringProvenanceSchema.optional(),
}).describe('Payload for INVOICE_WRITTEN_OFF');

export type InvoiceWrittenOffEventPayload = z.infer<typeof invoiceWrittenOffEventPayloadSchema>;

export const paymentRecordedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  paymentId: paymentIdSchema,
  clientId: clientIdSchema.optional(),
  receivedAt: z.string().datetime().optional(),
  amount: z.string().min(1),
  currency: currencySchema,
  method: z.string().min(1),
  receivedByUserId: userIdSchema.optional(),
  gatewayTransactionId: z.string().optional(),
}).describe('Payload for PAYMENT_RECORDED');

export type PaymentRecordedEventPayload = z.infer<typeof paymentRecordedEventPayloadSchema>;

export const paymentAppliedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  paymentId: paymentIdSchema,
  appliedAt: z.string().datetime().optional(),
  appliedByUserId: userIdSchema.optional(),
  applications: z
    .array(
      z.object({
        invoiceId: invoiceIdSchema,
        amountApplied: z.string().min(1),
      })
    )
    .min(1),
}).describe('Payload for PAYMENT_APPLIED');

export type PaymentAppliedEventPayload = z.infer<typeof paymentAppliedEventPayloadSchema>;

export const paymentFailedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  paymentId: paymentIdSchema.optional(),
  invoiceId: invoiceIdSchema.optional(),
  clientId: clientIdSchema.optional(),
  failedAt: z.string().datetime().optional(),
  amount: z.string().min(1),
  currency: currencySchema,
  method: z.string().min(1),
  failureCode: z.string().optional(),
  failureMessage: z.string().optional(),
  retryable: z.boolean().optional(),
}).describe('Payload for PAYMENT_FAILED');

export type PaymentFailedEventPayload = z.infer<typeof paymentFailedEventPayloadSchema>;

export const paymentRefundedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  paymentId: paymentIdSchema,
  refundedAt: z.string().datetime().optional(),
  refundedByUserId: userIdSchema.optional(),
  amount: z.string().min(1),
  currency: currencySchema,
  reason: z.string().optional(),
}).describe('Payload for PAYMENT_REFUNDED');

export type PaymentRefundedEventPayload = z.infer<typeof paymentRefundedEventPayloadSchema>;

export const creditNoteCreatedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  creditNoteId: creditNoteIdSchema,
  clientId: clientIdSchema.optional(),
  createdByUserId: userIdSchema.optional(),
  createdAt: z.string().datetime().optional(),
  amount: z.string().min(1),
  currency: currencySchema,
  status: z.string().min(1),
  sourceDocumentKind: z.enum(['prepayment_invoice', 'negative_invoice']).optional(),
  sourceInvoiceId: invoiceIdSchema.optional(),
  sourceInvoiceNumber: z.string().min(1).optional(),
  sourceInvoiceStatus: z.string().min(1).optional(),
  sourceInvoiceDateBasis: z.enum(['financial_document_date', 'canonical_recurring_service_period']).optional(),
  sourceServicePeriodStart: z.string().datetime().nullable().optional(),
  sourceServicePeriodEnd: z.string().datetime().nullable().optional(),
}).describe('Payload for CREDIT_NOTE_CREATED');

export type CreditNoteCreatedEventPayload = z.infer<typeof creditNoteCreatedEventPayloadSchema>;

export const creditNoteAppliedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  creditNoteId: creditNoteIdSchema,
  invoiceId: invoiceIdSchema,
  appliedByUserId: userIdSchema.optional(),
  appliedAt: z.string().datetime().optional(),
  amountApplied: z.string().min(1),
  currency: currencySchema,
  appliedInvoiceNumber: z.string().min(1).optional(),
  appliedInvoiceStatus: z.string().min(1).optional(),
  appliedInvoiceDateBasis: z.enum(['financial_document_date', 'canonical_recurring_service_period']).optional(),
  appliedServicePeriodStart: z.string().datetime().nullable().optional(),
  appliedServicePeriodEnd: z.string().datetime().nullable().optional(),
}).describe('Payload for CREDIT_NOTE_APPLIED');

export type CreditNoteAppliedEventPayload = z.infer<typeof creditNoteAppliedEventPayloadSchema>;

export const creditNoteVoidedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  creditNoteId: creditNoteIdSchema,
  voidedByUserId: userIdSchema.optional(),
  voidedAt: z.string().datetime().optional(),
  reason: z.string().optional(),
}).describe('Payload for CREDIT_NOTE_VOIDED');

export type CreditNoteVoidedEventPayload = z.infer<typeof creditNoteVoidedEventPayloadSchema>;

export const contractCreatedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  contractId: contractIdSchema,
  clientId: clientIdSchema,
  createdByUserId: userIdSchema.optional(),
  createdAt: z.string().datetime().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  status: z.string().optional(),
}).describe('Payload for CONTRACT_CREATED');

export type ContractCreatedEventPayload = z.infer<typeof contractCreatedEventPayloadSchema>;

export const contractUpdatedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  contractId: contractIdSchema,
  clientId: clientIdSchema,
  updatedAt: z.string().datetime().optional(),
  updatedFields: updatedFieldsSchema,
  changes: changesSchema,
}).describe('Payload for CONTRACT_UPDATED');

export type ContractUpdatedEventPayload = z.infer<typeof contractUpdatedEventPayloadSchema>;

export const contractStatusChangedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  contractId: contractIdSchema,
  clientId: clientIdSchema,
  previousStatus: z.string().min(1),
  newStatus: z.string().min(1),
  changedAt: z.string().datetime().optional(),
}).describe('Payload for CONTRACT_STATUS_CHANGED');

export type ContractStatusChangedEventPayload = z.infer<typeof contractStatusChangedEventPayloadSchema>;

export const contractRenewalUpcomingEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  contractId: contractIdSchema,
  clientId: clientIdSchema,
  renewalAt: z.string().min(1),
  decisionDueDate: z.string().min(1).optional(),
  daysUntilRenewal: z.number().int().nonnegative(),
  daysUntilDecisionDue: z.number().int().nonnegative().optional(),
  renewalCycleKey: z.string().min(1).optional(),
}).describe('Payload for CONTRACT_RENEWAL_UPCOMING');

export type ContractRenewalUpcomingEventPayload = z.infer<typeof contractRenewalUpcomingEventPayloadSchema>;

const runIdSchema = uuidSchema('Run ID');

export const recurringBillingRunStartedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  runId: runIdSchema,
  scheduleId: z.string().uuid().optional(),
  startedAt: z.string().datetime().optional(),
  initiatedByUserId: userIdSchema.optional(),
  selectionKey: z.string().min(1).optional(),
  retryKey: z.string().min(1).optional(),
  selectionMode: recurringBillingRunSelectionModeSchema,
  windowIdentity: recurringBillingRunWindowIdentitySchema,
  executionWindowKinds: z.array(recurringBillingRunExecutionWindowKindSchema).min(1).optional(),
}).describe('Payload for RECURRING_BILLING_RUN_STARTED');

export type RecurringBillingRunStartedEventPayload = z.infer<typeof recurringBillingRunStartedEventPayloadSchema>;

export const recurringBillingRunCompletedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  runId: runIdSchema,
  completedAt: z.string().datetime().optional(),
  invoicesCreated: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  warnings: z.array(z.string()).optional(),
  selectionKey: z.string().min(1).optional(),
  retryKey: z.string().min(1).optional(),
  selectionMode: recurringBillingRunSelectionModeSchema,
  windowIdentity: recurringBillingRunWindowIdentitySchema,
  executionWindowKinds: z.array(recurringBillingRunExecutionWindowKindSchema).min(1).optional(),
}).describe('Payload for RECURRING_BILLING_RUN_COMPLETED');

export type RecurringBillingRunCompletedEventPayload = z.infer<typeof recurringBillingRunCompletedEventPayloadSchema>;

export const recurringBillingRunFailedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  runId: runIdSchema,
  failedAt: z.string().datetime().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().min(1),
  retryable: z.boolean().optional(),
  selectionKey: z.string().min(1).optional(),
  retryKey: z.string().min(1).optional(),
  selectionMode: recurringBillingRunSelectionModeSchema,
  windowIdentity: recurringBillingRunWindowIdentitySchema,
  executionWindowKinds: z.array(recurringBillingRunExecutionWindowKindSchema).min(1).optional(),
}).describe('Payload for RECURRING_BILLING_RUN_FAILED');

export type RecurringBillingRunFailedEventPayload = z.infer<typeof recurringBillingRunFailedEventPayloadSchema>;
