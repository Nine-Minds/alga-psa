import {
  buildContractCreatedPayload,
  buildContractRecordCreatedPayload,
  buildContractRecordUpdatedPayload,
  buildContractRenewalUpcomingPayload,
  buildContractStatusChangedPayload,
  buildContractUpdatedPayload,
  buildCreditNoteAppliedPayload,
  buildCreditNoteCreatedPayload,
  buildCreditNoteVoidedPayload,
  buildRecurringBillingRunCompletedPayload,
  buildRecurringBillingRunFailedPayload,
  buildRecurringBillingRunStartedPayload,
} from '@alga-psa/workflow-streams';
import {
  buildInvoiceDueDateChangedPayload,
  buildInvoiceFinalizedPayload,
  buildInvoiceOverduePayload,
  buildInvoiceSentPayload,
  buildInvoiceStatusChangedPayload,
  buildInvoiceWrittenOffPayload,
  summarizeInvoiceRecurringProvenance,
} from '../../../../lib/api/services/invoiceWorkflowEvents';
import {
  buildPaymentAppliedPayload,
  buildPaymentFailedPayload,
  buildPaymentRecordedPayload,
  buildPaymentRefundedPayload,
} from '../../../../lib/api/services/paymentWorkflowEvents';
import type { EmitterContracts } from '../registryTypes';
import { NO_EMITTER_UMBRELLA_TICKET } from '../registryTypes';
import { IDS, NOW, EARLIER } from '../fixtures';

/**
 * Billing: invoices, payments, credit notes, contracts, recurring billing runs.
 *
 * Builders for invoices and payments live next to their service (invoiceWorkflowEvents.ts,
 * paymentWorkflowEvents.ts); contract / credit note / run builders are in domainEventBuilders.
 * INVOICE_FINALIZED and the contract-record CONTRACT_CREATED/UPDATED were hand-built at the call
 * site and got builders here. The 11 PROJECT_* billing events are in the schema-not-registered set.
 */

const INVOICE_SERVICE = 'server/src/lib/api/services/InvoiceService.ts';
const PAYMENT_SERVICE = 'ee/server/src/lib/payments/PaymentService.ts';
const AUTOPAY = 'ee/server/src/lib/payments/AutopayService.ts';
const BILLING = 'packages/billing/src/actions';
const CLIENT_CONTRACTS = 'packages/clients/src/actions/clientContractActions.ts';

type BillingEventType =
  | 'INVOICE_FINALIZED'
  | 'INVOICE_SENT'
  | 'INVOICE_STATUS_CHANGED'
  | 'INVOICE_DUE_DATE_CHANGED'
  | 'INVOICE_OVERDUE'
  | 'INVOICE_WRITTEN_OFF'
  | 'INVOICE_GENERATED'
  | 'PAYMENT_RECORDED'
  | 'PAYMENT_APPLIED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_REFUNDED'
  | 'CREDIT_NOTE_CREATED'
  | 'CREDIT_NOTE_APPLIED'
  | 'CREDIT_NOTE_VOIDED'
  | 'CONTRACT_CREATED'
  | 'CONTRACT_UPDATED'
  | 'CONTRACT_STATUS_CHANGED'
  | 'CONTRACT_RENEWAL_UPCOMING'
  | 'RECURRING_BILLING_RUN_STARTED'
  | 'RECURRING_BILLING_RUN_COMPLETED'
  | 'RECURRING_BILLING_RUN_FAILED';

// Service periods reach events through InvoiceModel.normalizeRecurringDetailPeriodDate, which turns
// the DATE column (a JS Date from pg) into `toISOString()`: full datetimes, not 'YYYY-MM-DD'.
const PERIOD_START = new Date('2026-06-01T00:00:00.000Z').toISOString();
const PERIOD_END = new Date('2026-06-30T00:00:00.000Z').toISOString();

const provenance = summarizeInvoiceRecurringProvenance([
  { service_period_start: PERIOD_START, service_period_end: PERIOD_END, billing_timing: 'arrears' },
]);
const invoiceId = IDS.invoice;
const user = { actor: { actorType: 'USER' as const, actorUserId: IDS.user } };
const system = { actor: { actorType: 'SYSTEM' as const } };

const statusChanged = (withProvenance: boolean) =>
  buildInvoiceStatusChangedPayload({
    invoiceId,
    previousStatus: 'draft',
    newStatus: 'sent',
    changedAt: NOW,
    ...(withProvenance ? { recurringProvenance: provenance } : {}),
  });

const sourceInvoice = {
  sourceInvoiceId: invoiceId,
  sourceInvoiceNumber: 'INV-000123',
  sourceInvoiceStatus: 'sent',
  sourceInvoiceDateBasis: 'canonical_recurring_service_period' as const,
  sourceServicePeriodStart: PERIOD_START,
  sourceServicePeriodEnd: PERIOD_END,
};

const runIdentity = {
  runId: IDS.billingRun,
  selectionKey: 'sel-2026-07',
  retryKey: 'retry-2026-07',
  selectionMode: 'due_service_periods' as const,
  windowIdentity: 'mixed_execution_windows' as const,
  executionWindowKinds: ['contract_cadence_window', 'client_cadence_window'] as Array<
    'contract_cadence_window' | 'client_cadence_window'
  >,
};

const contractBefore = { status: 'draft', contract_name: 'Managed services', end_date: null };
const contractAfter = { status: 'active', contract_name: 'Managed services (2026)', end_date: '2027-06-30' };

export const billingContracts = {
  INVOICE_GENERATED: {
    status: 'no-product-emitter',
    ticket: NO_EMITTER_UMBRELLA_TICKET,
    reason:
      'Catalogued and listed in the event-bus fan-out sets, but no product code publishes INVOICE_GENERATED (invoice generation only fires analytics).',
  },

  INVOICE_FINALIZED: {
    status: 'covered',
    cases: [
      {
        site: `${INVOICE_SERVICE}#InvoiceService.finalizeInvoice`,
        ctx: { ...user, occurredAt: NOW },
        expectFields: ['userId', 'timestamp'],
        build: () => buildInvoiceFinalizedPayload({ invoiceId, totalAmount: 1234.5, userId: IDS.user, occurredAt: NOW }),
      },
    ],
  },
  INVOICE_SENT: {
    status: 'covered',
    cases: [
      {
        site: `${INVOICE_SERVICE}#InvoiceService.sendInvoice`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildInvoiceSentPayload({
            invoiceId,
            clientId: IDS.client,
            sentByUserId: IDS.user,
            sentAt: NOW,
            deliveryMethod: 'email',
            recurringProvenance: provenance,
          }),
      },
      {
        site: `${INVOICE_SERVICE}#InvoiceService.sendInvoice`,
        ctx: { ...user, occurredAt: NOW },
        build: () => buildInvoiceSentPayload({ invoiceId, clientId: null, sentAt: NOW, deliveryMethod: 'portal' }),
      },
    ],
  },
  INVOICE_STATUS_CHANGED: {
    status: 'covered',
    cases: [
      { site: `${INVOICE_SERVICE}#InvoiceService.update`, ctx: { ...user, occurredAt: NOW }, build: () => statusChanged(true) },
      { site: `${INVOICE_SERVICE}#InvoiceService.finalizeInvoice`, ctx: user, build: () => statusChanged(false) },
      { site: `${INVOICE_SERVICE}#InvoiceService.sendInvoice`, ctx: { ...user, occurredAt: NOW }, build: () => statusChanged(true) },
      { site: `${INVOICE_SERVICE}#InvoiceService.delete`, ctx: { ...user, occurredAt: NOW }, build: () => statusChanged(true) },
      { site: `${INVOICE_SERVICE}#InvoiceService.recordPayment`, ctx: { ...user, occurredAt: NOW }, build: () => statusChanged(false) },
      { site: `${INVOICE_SERVICE}#InvoiceService.recordRefund`, ctx: { ...user, occurredAt: NOW }, build: () => statusChanged(false) },
      { site: `${INVOICE_SERVICE}#InvoiceService.bulkUpdateStatus`, ctx: { ...user, occurredAt: NOW }, build: () => statusChanged(true) },
    ],
  },
  INVOICE_DUE_DATE_CHANGED: {
    status: 'covered',
    cases: [
      {
        site: `${INVOICE_SERVICE}#InvoiceService.update`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildInvoiceDueDateChangedPayload({
            invoiceId,
            previousDueDate: '2026-07-31',
            newDueDate: '2026-08-15',
            changedAt: NOW,
            recurringProvenance: provenance,
          }),
      },
    ],
  },
  INVOICE_OVERDUE: {
    status: 'covered',
    cases: [
      {
        site: `${INVOICE_SERVICE}#InvoiceService.update`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildInvoiceOverduePayload({
            invoiceId,
            clientId: IDS.client,
            overdueAt: NOW,
            dueDate: '2026-07-01',
            amountDue: 980.25,
            currency: 'USD',
            recurringProvenance: provenance,
          }),
      },
      {
        site: `${INVOICE_SERVICE}#InvoiceService.bulkUpdateStatus`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildInvoiceOverduePayload({
            invoiceId,
            clientId: IDS.client,
            overdueAt: NOW,
            dueDate: '2026-07-16',
            amountDue: 0,
            currency: 'EUR',
          }),
      },
    ],
  },
  INVOICE_WRITTEN_OFF: {
    status: 'covered',
    cases: [
      {
        site: `${INVOICE_SERVICE}#InvoiceService.update`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildInvoiceWrittenOffPayload({
            invoiceId,
            writtenOffAt: NOW,
            amountWrittenOff: 980.25,
            currency: 'USD',
            recurringProvenance: provenance,
          }),
      },
      {
        site: `${INVOICE_SERVICE}#InvoiceService.bulkUpdateStatus`,
        ctx: { ...user, occurredAt: NOW },
        build: () => buildInvoiceWrittenOffPayload({ invoiceId, writtenOffAt: NOW, amountWrittenOff: 15, currency: 'USD' }),
      },
    ],
  },

  PAYMENT_RECORDED: {
    status: 'covered',
    cases: [
      {
        site: `${INVOICE_SERVICE}#InvoiceService.recordPayment`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildPaymentRecordedPayload({
            paymentId: IDS.payment,
            clientId: IDS.client,
            receivedAt: NOW,
            amount: 500,
            currency: 'USD',
            method: 'check',
            receivedByUserId: IDS.user,
            gatewayTransactionId: 'CHK-1042',
          }),
      },
      {
        site: `${PAYMENT_SERVICE}#PaymentService.recordPaymentFromWebhook`,
        ctx: { ...system, occurredAt: NOW },
        build: () =>
          buildPaymentRecordedPayload({
            paymentId: IDS.payment,
            clientId: IDS.client,
            receivedAt: NOW,
            amount: 500,
            currency: 'USD',
            method: 'stripe',
            gatewayTransactionId: 'pi_3Nabc',
          }),
      },
    ],
  },
  PAYMENT_APPLIED: {
    status: 'covered',
    cases: [
      {
        site: `${INVOICE_SERVICE}#InvoiceService.recordPayment`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildPaymentAppliedPayload({
            paymentId: IDS.payment,
            appliedAt: NOW,
            appliedByUserId: IDS.user,
            applications: [{ invoiceId, amountApplied: 500 }],
          }),
      },
      {
        site: `${PAYMENT_SERVICE}#PaymentService.recordPaymentFromWebhook`,
        ctx: { ...system, occurredAt: NOW },
        build: () =>
          buildPaymentAppliedPayload({
            paymentId: IDS.payment,
            appliedAt: NOW,
            applications: [{ invoiceId, amountApplied: 500 }],
          }),
      },
    ],
  },
  PAYMENT_FAILED: {
    status: 'covered',
    cases: [
      {
        site: `${PAYMENT_SERVICE}#PaymentService.handlePaymentFailed`,
        ctx: { ...system, occurredAt: NOW },
        build: () =>
          buildPaymentFailedPayload({
            invoiceId,
            clientId: IDS.client,
            failedAt: NOW,
            amount: 500,
            currency: 'USD',
            method: 'stripe',
          }),
      },
      {
        site: `${AUTOPAY}#AutopayService.finishAutopayWithFallback`,
        ctx: { ...system, occurredAt: NOW },
        build: () =>
          buildPaymentFailedPayload({
            invoiceId,
            clientId: IDS.client,
            failedAt: NOW,
            amount: 500,
            currency: 'USD',
            method: 'stripe',
            failureCode: 'payment_failed',
            failureMessage: 'Auto-pay attempts were exhausted',
            retryable: false,
          }),
      },
      {
        site: `${AUTOPAY}#AutopayService.failAttempt`,
        ctx: { ...system, occurredAt: NOW },
        build: () =>
          buildPaymentFailedPayload({
            invoiceId,
            clientId: undefined,
            failedAt: NOW,
            amount: 500,
            currency: 'USD',
            method: 'stripe',
            failureCode: 'card_declined',
            failureMessage: 'Your card was declined.',
            retryable: true,
          }),
      },
    ],
  },
  PAYMENT_REFUNDED: {
    status: 'covered',
    cases: [
      {
        site: `${INVOICE_SERVICE}#InvoiceService.recordRefund`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildPaymentRefundedPayload({
            paymentId: IDS.payment,
            refundedAt: NOW,
            refundedByUserId: IDS.user,
            amount: 100,
            currency: 'USD',
            reason: 'Duplicate charge',
          }),
      },
      {
        site: `${PAYMENT_SERVICE}#PaymentService.handleChargeRefunded`,
        ctx: { ...system, occurredAt: NOW },
        build: () =>
          buildPaymentRefundedPayload({
            paymentId: IDS.payment,
            refundedAt: NOW,
            amount: 100,
            currency: 'USD',
            reason: 'Stripe refund via charge.refunded',
          }),
      },
    ],
  },

  CREDIT_NOTE_CREATED: {
    status: 'covered',
    cases: [
      {
        site: `${BILLING}/invoiceModification.ts#finalizeInvoiceWithKnex`,
        ctx: { ...user, occurredAt: EARLIER },
        build: () =>
          buildCreditNoteCreatedPayload({
            creditNoteId: IDS.creditNote,
            clientId: IDS.client,
            createdByUserId: IDS.user,
            createdAt: EARLIER,
            amount: 250,
            currency: 'USD',
            status: 'issued',
            sourceDocumentKind: 'negative_invoice',
            ...sourceInvoice,
          }),
      },
      {
        site: `${BILLING}/invoiceModification.ts#finalizeInvoiceWithKnex`,
        ctx: { ...system, occurredAt: EARLIER },
        build: () =>
          buildCreditNoteCreatedPayload({
            creditNoteId: IDS.creditNote,
            clientId: IDS.client,
            createdAt: EARLIER,
            amount: 250,
            currency: 'USD',
            status: 'issued',
            sourceInvoiceId: invoiceId,
            sourceInvoiceNumber: 'INV-000123',
            sourceInvoiceStatus: 'draft',
            sourceInvoiceDateBasis: 'financial_document_date',
            sourceServicePeriodStart: null,
            sourceServicePeriodEnd: null,
          }),
      },
      {
        site: `${BILLING}/creditActions.ts#grantCredit`,
        ctx: { ...user, occurredAt: EARLIER },
        build: () =>
          buildCreditNoteCreatedPayload({
            creditNoteId: IDS.creditNote,
            clientId: IDS.client,
            createdByUserId: IDS.user,
            createdAt: EARLIER,
            amount: 75,
            currency: 'USD',
            status: 'issued',
            sourceDocumentKind: 'direct_grant',
            sourceInvoiceId: null,
            sourceInvoiceNumber: null,
            sourceInvoiceStatus: null,
            sourceInvoiceDateBasis: 'financial_document_date',
            sourceServicePeriodStart: null,
            sourceServicePeriodEnd: null,
          }),
      },
    ],
  },
  CREDIT_NOTE_APPLIED: {
    status: 'covered',
    cases: [
      {
        site: `${BILLING}/creditActions.ts#applyCreditToInvoiceInternal`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildCreditNoteAppliedPayload({
            creditNoteId: IDS.creditNote,
            invoiceId,
            appliedByUserId: IDS.user,
            appliedAt: NOW,
            amountApplied: 75,
            currency: 'USD',
            appliedInvoiceNumber: 'INV-000123',
            appliedInvoiceStatus: 'sent',
            appliedInvoiceDateBasis: 'canonical_recurring_service_period',
            appliedServicePeriodStart: PERIOD_START,
            appliedServicePeriodEnd: PERIOD_END,
          }),
      },
    ],
  },
  CREDIT_NOTE_VOIDED: {
    status: 'covered',
    cases: [
      {
        site: `${BILLING}/invoiceModification.ts#hardDeleteInvoice`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildCreditNoteVoidedPayload({
            creditNoteId: IDS.creditNote,
            voidedByUserId: IDS.user,
            voidedAt: NOW,
            reason: 'Invoice deleted',
          }),
      },
    ],
  },

  CONTRACT_CREATED: {
    status: 'covered',
    cases: [
      {
        site: `${BILLING}/contractActions.ts#createContract`,
        ctx: { ...user, occurredAt: EARLIER },
        expectFields: ['userId', 'timestamp'],
        build: () =>
          buildContractRecordCreatedPayload({
            contractId: IDS.contract,
            ownerClientId: IDS.client,
            userId: IDS.user,
            occurredAt: EARLIER,
            status: 'draft',
          }),
      },
      {
        site: `${BILLING}/contractWizardActions.ts#createClientContractFromWizard`,
        ctx: { ...user, occurredAt: EARLIER },
        build: () =>
          buildContractCreatedPayload({
            contractId: IDS.contract,
            clientId: IDS.client,
            createdByUserId: IDS.user,
            createdAt: EARLIER,
            startDate: '2026-07-01',
            endDate: null,
            status: 'active',
          }),
      },
      {
        site: `${BILLING}/billingClientsActions.ts#activateClientContractForBilling`,
        ctx: { ...user, occurredAt: EARLIER },
        build: () =>
          buildContractCreatedPayload({
            contractId: IDS.contract,
            clientId: IDS.client,
            createdByUserId: IDS.user,
            createdAt: EARLIER,
            startDate: '2026-07-01',
            endDate: '2027-06-30',
            status: 'active',
          }),
      },
      {
        site: `${CLIENT_CONTRACTS}#assignContractToClient`,
        ctx: { ...user, occurredAt: EARLIER },
        build: () =>
          buildContractCreatedPayload({
            contractId: IDS.contract,
            clientId: IDS.client,
            createdByUserId: IDS.user,
            createdAt: EARLIER,
            startDate: '2026-07-01',
            endDate: '2027-06-30',
            status: 'active',
          }),
      },
      {
        site: `${CLIENT_CONTRACTS}#createClientContract`,
        ctx: { ...user, occurredAt: EARLIER },
        build: () =>
          buildContractCreatedPayload({
            contractId: IDS.contract,
            clientId: IDS.client,
            createdByUserId: IDS.user,
            createdAt: EARLIER,
            startDate: '2026-07-01',
            endDate: null,
            status: 'pending',
          }),
      },
    ],
  },
  CONTRACT_UPDATED: {
    status: 'covered',
    cases: [
      {
        site: `${BILLING}/contractActions.ts#updateContract`,
        ctx: { ...user, occurredAt: NOW },
        expectFields: ['userId', 'timestamp'],
        build: () =>
          buildContractRecordUpdatedPayload({
            contractId: IDS.contract,
            ownerClientId: IDS.client,
            userId: IDS.user,
            occurredAt: NOW,
            status: 'active',
            patch: { status: 'active', contract_name: 'Managed services (2026)', end_date: '2027-06-30' },
            before: contractBefore,
            after: contractAfter,
          }),
      },
      {
        site: `${CLIENT_CONTRACTS}#updateClientContract`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildContractUpdatedPayload({
            contractId: IDS.contract,
            clientId: IDS.client,
            updatedAt: NOW,
            updatedFields: ['end_date'],
            changes: { end_date: { previous: null, new: '2027-06-30' } },
          }),
      },
    ],
  },
  CONTRACT_STATUS_CHANGED: {
    status: 'covered',
    cases: [
      {
        site: `${CLIENT_CONTRACTS}#updateClientContract`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildContractStatusChangedPayload({
            contractId: IDS.contract,
            clientId: IDS.client,
            previousStatus: 'pending',
            newStatus: 'active',
            changedAt: NOW,
          }),
      },
      {
        site: `${CLIENT_CONTRACTS}#deactivateClientContract`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildContractStatusChangedPayload({
            contractId: IDS.contract,
            clientId: IDS.client,
            previousStatus: 'active',
            newStatus: 'terminated',
            changedAt: NOW,
          }),
      },
    ],
  },
  CONTRACT_RENEWAL_UPCOMING: {
    status: 'covered',
    cases: [
      {
        site: 'packages/jobs/src/lib/dateTriggers/sources/contractRenewalDecision.ts#contractRenewalDecisionSource',
        ctx: { ...system, occurredAt: NOW },
        build: () =>
          buildContractRenewalUpcomingPayload({
            contractId: IDS.contract,
            clientId: IDS.client,
            renewalAt: '2026-10-14',
            decisionDueDate: '2026-07-16',
            daysUntilRenewal: 90,
            daysUntilDecisionDue: 90,
            renewalCycleKey: '2026-10-14',
          }),
      },
      {
        site: `${CLIENT_CONTRACTS}#createClientContract`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildContractRenewalUpcomingPayload({
            contractId: IDS.contract,
            clientId: IDS.client,
            renewalAt: '2027-06-30',
            decisionDueDate: '2027-04-01',
            daysUntilRenewal: 349,
            daysUntilDecisionDue: 259,
          }),
      },
    ],
  },

  RECURRING_BILLING_RUN_STARTED: {
    status: 'covered',
    cases: [
      {
        site: `${BILLING}/recurringBillingRunActions.ts#generateInvoicesAsRecurringBillingRun`,
        ctx: { ...user, occurredAt: NOW, correlationId: IDS.billingRun },
        build: () => buildRecurringBillingRunStartedPayload({ ...runIdentity, startedAt: NOW, initiatedByUserId: IDS.user }),
      },
      {
        site: `${BILLING}/recurringBillingRunActions.ts#generateGroupedInvoicesAsRecurringBillingRun`,
        ctx: { ...user, occurredAt: NOW, correlationId: IDS.billingRun },
        build: () =>
          buildRecurringBillingRunStartedPayload({
            runId: IDS.billingRun,
            startedAt: NOW,
            initiatedByUserId: IDS.user,
          }),
      },
    ],
  },
  RECURRING_BILLING_RUN_COMPLETED: {
    status: 'covered',
    cases: [
      {
        site: `${BILLING}/recurringBillingRunActions.ts#generateInvoicesAsRecurringBillingRun`,
        ctx: { ...user, occurredAt: NOW, correlationId: IDS.billingRun },
        build: () => buildRecurringBillingRunCompletedPayload({ ...runIdentity, completedAt: NOW, invoicesCreated: 12, failedCount: 1 }),
      },
      {
        site: `${BILLING}/recurringBillingRunActions.ts#generateGroupedInvoicesAsRecurringBillingRun`,
        ctx: { ...user, occurredAt: NOW, correlationId: IDS.billingRun },
        build: () =>
          buildRecurringBillingRunCompletedPayload({
            ...runIdentity,
            completedAt: NOW,
            invoicesCreated: 3,
            failedCount: 0,
            warnings: ['Skipped one client with no billable charges'],
          }),
      },
    ],
  },
  RECURRING_BILLING_RUN_FAILED: {
    status: 'covered',
    cases: [
      {
        site: `${BILLING}/recurringBillingRunActions.ts#generateInvoicesAsRecurringBillingRun`,
        ctx: { ...user, occurredAt: NOW, correlationId: IDS.billingRun },
        build: () =>
          buildRecurringBillingRunFailedPayload({ ...runIdentity, failedAt: NOW, errorMessage: 'Tax service unavailable', retryable: true }),
      },
      {
        site: `${BILLING}/recurringBillingRunActions.ts#generateGroupedInvoicesAsRecurringBillingRun`,
        ctx: { ...user, occurredAt: NOW, correlationId: IDS.billingRun },
        build: () =>
          buildRecurringBillingRunFailedPayload({
            runId: IDS.billingRun,
            failedAt: NOW,
            errorCode: 'BILLING_RUN_FAILED',
            errorMessage: 'Unknown error occurred while generating invoices',
            retryable: true,
          }),
      },
    ],
  },
} satisfies Pick<EmitterContracts, BillingEventType>;

