// @ts-nocheck
'use server'

import { tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { requireTenantId } from '@alga-psa/db';
import { SharedNumberingService } from '@alga-psa/shared/services/numberingService';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getAnalyticsAsync } from '../lib/authHelpers';
import { BillingEngine } from '../lib/billing/billingEngine';
import ProjectBillingCapUsage from '../models/projectBillingCapUsage';
import ProjectBillingConfig from '../models/projectBillingConfig';
import ProjectBillingScheduleEntry from '../models/projectBillingScheduleEntry';
import {
  computeCapWriteDown,
  detectThresholdCrossings,
} from '../services/projectBillingService';
import ClientContractLine from '../models/clientContractLine';
import { Session } from 'next-auth';
import {
  IInvoiceCharge,
  IInvoice,
  IRecurringDueSelectionInput,
  PreviewInvoiceResponse,
  InvoiceViewModel,
  DEFAULT_RECURRING_SERVICE_PERIOD_DUE_SELECTION_STATES,
} from '@alga-psa/types';
import { WasmInvoiceViewModel } from '@alga-psa/types';
import { IBillingResult, IBillingCharge, IBucketCharge, IUsageBasedCharge, ITimeBasedCharge, IFixedPriceCharge, IProductCharge, ILicenseCharge, BillingCycleType } from '@alga-psa/types';
import { IClient, IClientWithLocation } from '@alga-psa/types';
import Invoice from '@alga-psa/billing/models/invoice';
import { createTenantKnex } from '@alga-psa/db';
import { Temporal } from '@js-temporal/polyfill';
import { createPDFGenerationService } from '../services/pdfGenerationService';
import { toPlainDate, toISODate, toISOTimestamp } from '@alga-psa/core';
import { ISO8601String } from '@alga-psa/types';
import { TaxService } from '../services/taxService';
import { ITaxCalculationResult } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';
import { auditLog } from '@alga-psa/db';
import { getClientLogoUrl } from '@alga-psa/formatting/avatarUtils';
import { calculateAndDistributeTax, getClientDetails, persistInvoiceCharges, updateInvoiceTotalsAndRecordTransaction, validateClientBillingEmail } from '../services/invoiceService';




// TODO: Import these from billingAndTax.ts once created
import { getNextBillingDate, getDueDate } from './billingAndTax'; // Updated import
import { getClientDefaultTaxRegionCode } from '@alga-psa/shared/billingClients';
import { applyCreditToInvoice } from './creditActions';
import { getCurrencySymbol } from '@alga-psa/core';
import { getInitialInvoiceTaxSource, shouldUseTaxDelegation } from './taxSourceActions';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';
import { finalizeInvoiceWithKnex } from './invoiceModification';
import {
  computePurchaseOrderOverage,
  getClientContractPurchaseOrderContext,
  getPurchaseOrderConsumedCents
} from '@alga-psa/billing/services/purchaseOrderService';
import {
  buildClientCadenceDueSelectionInput,
  buildContractCadenceDueSelectionInput,
} from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';
import {
  CLIENT_CADENCE_POST_DROP_OBLIGATION_TYPE,
  POST_DROP_RECURRING_OBLIGATION_TYPES,
} from '@alga-psa/shared/billingClients/postDropRecurringObligationIdentity';
import { DUPLICATE_RECURRING_INVOICE_CODE } from './invoiceGeneration.constants';
import {
  detectRecurringApprovalBlockers,
  formatApprovalBlockedReason,
} from './recurringApprovalBlockers';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { publishEvent } from '@alga-psa/event-bus/publishers';
// TODO: Move these type guards to billingAndTax.ts or a shared utility file
const POSTGRES_UNDEFINED_TABLE = '42P01';
type InvoiceGenerationActionError = ActionMessageError | ActionPermissionError;

function isReturnedActionError(value: unknown): value is InvoiceGenerationActionError {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (
        typeof (value as { actionError?: unknown }).actionError === 'string' ||
        typeof (value as { permissionError?: unknown }).permissionError === 'string'
      )
  );
}

function unwrapBillingHelperResult<T>(value: T | InvoiceGenerationActionError): T {
  if (isReturnedActionError(value)) {
    throw new Error('permissionError' in value ? value.permissionError : value.actionError);
  }

  return value;
}

function isMissingRelationError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === POSTGRES_UNDEFINED_TABLE
  );
}

function isFixedPriceCharge(charge: IBillingCharge): charge is IFixedPriceCharge {
  return charge.type === 'fixed';
}

function isTimeBasedCharge(charge: IBillingCharge): charge is ITimeBasedCharge {
  return charge.type === 'time';
}

function isUsageBasedCharge(charge: IBillingCharge): charge is IUsageBasedCharge {
  return charge.type === 'usage';
}

function isBucketCharge(charge: IBillingCharge): charge is IBucketCharge {
  return charge.type === 'bucket';
}

function isProductCharge(charge: IBillingCharge): charge is IProductCharge {
  return charge.type === 'product';
}

function isLicenseCharge(charge: IBillingCharge): charge is ILicenseCharge {
  return charge.type === 'license';
}

function isProjectScheduleCharge(charge: IBillingCharge): boolean {
  return charge.type === 'project_milestone' || charge.type === 'project_deposit';
}

function getProjectChargeMetadata(charge: IBillingCharge): {
  projectId: string;
  projectName: string;
  projectNumber: string;
} | null {
  const candidate = charge as IBillingCharge & {
    project_id?: string;
    project_name?: string;
    project_number?: string;
  };
  if (!candidate.project_id || !candidate.project_name) {
    return null;
  }
  return {
    projectId: candidate.project_id,
    projectName: candidate.project_name,
    projectNumber: candidate.project_number ?? '',
  };
}

function getSingleClientContractIdFromCharges(charges: IBillingCharge[]): string | null {
  const ids = Array.from(
    new Set(
      charges
        .map((c) => c.client_contract_id)
        .filter((value): value is string => Boolean(value && value.trim().length > 0))
    )
  );

  if (ids.length === 0) {
    return null;
  }
  if (ids.length > 1) {
    // Multi-assignment combined invoices do not require a synthetic header owner.
    return null;
  }
  return ids[0];
}

// TODO: Move to billingAndTax.ts or a shared utility file
// Uses local type guards now
function getChargeQuantity(charge: IBillingCharge): number {
  if (isBucketCharge(charge)) return charge.isUsageBucket ? charge.overageUnits ?? charge.quantity ?? 0 : charge.overageHours;
  if (isFixedPriceCharge(charge) || isUsageBasedCharge(charge)) return charge.quantity;
  if (isTimeBasedCharge(charge)) return charge.duration;
  if (isProductCharge(charge) || isLicenseCharge(charge)) return charge.quantity;
  return 1;
}

// TODO: Move to billingAndTax.ts or a shared utility file
// Uses local type guards now
function getChargeUnitPrice(charge: IBillingCharge): number {
  if (isBucketCharge(charge)) return charge.overageRate;
  return charge.rate;
}

function normalizePreviewRecurringDetailPeriods(
  item: Pick<IBillingCharge, 'recurringDetailPeriods' | 'servicePeriodStart' | 'servicePeriodEnd' | 'billingTiming'> |
    Pick<IInvoiceCharge, 'recurring_detail_periods' | 'service_period_start' | 'service_period_end' | 'billing_timing'>
) {
  const camelCaseCandidate = 'recurringDetailPeriods' in item ? item.recurringDetailPeriods : undefined;
  const snakeCaseCandidate = 'recurring_detail_periods' in item ? item.recurring_detail_periods : undefined;
  const candidate = Array.isArray(camelCaseCandidate)
    ? camelCaseCandidate
    : Array.isArray(snakeCaseCandidate)
      ? snakeCaseCandidate.map((detail) => ({
          servicePeriodStart: detail.service_period_start ?? null,
          servicePeriodEnd: detail.service_period_end ?? null,
          billingTiming: detail.billing_timing ?? null,
        }))
      : [];

  const normalized = candidate
    .map((detail) => ({
      servicePeriodStart: detail.servicePeriodStart ?? null,
      servicePeriodEnd: detail.servicePeriodEnd ?? null,
      billingTiming: detail.billingTiming ?? null,
    }))
    .filter((detail) => detail.servicePeriodStart || detail.servicePeriodEnd || detail.billingTiming)
    .sort((left, right) => {
      if (left.servicePeriodStart !== right.servicePeriodStart) {
        return String(left.servicePeriodStart ?? '').localeCompare(String(right.servicePeriodStart ?? ''));
      }
      return String(left.servicePeriodEnd ?? '').localeCompare(String(right.servicePeriodEnd ?? ''));
    });

  return normalized.length > 0 ? normalized : undefined;
}

function resolvePreviewRecurringSummary(
  item: Pick<IBillingCharge, 'recurringDetailPeriods' | 'servicePeriodStart' | 'servicePeriodEnd' | 'billingTiming'> |
    Pick<IInvoiceCharge, 'recurring_detail_periods' | 'service_period_start' | 'service_period_end' | 'billing_timing'>
) {
  const recurringDetailPeriods = normalizePreviewRecurringDetailPeriods(item);
  const explicitStart =
    'servicePeriodStart' in item ? item.servicePeriodStart : item.service_period_start;
  const explicitEnd =
    'servicePeriodEnd' in item ? item.servicePeriodEnd : item.service_period_end;
  const explicitBillingTiming =
    'billingTiming' in item ? item.billingTiming : item.billing_timing;

  const servicePeriodStart =
    explicitStart ?? recurringDetailPeriods?.[0]?.servicePeriodStart ?? null;
  const servicePeriodEnd =
    explicitEnd ?? recurringDetailPeriods?.[recurringDetailPeriods.length - 1]?.servicePeriodEnd ?? null;
  const billingTiming = explicitBillingTiming ?? (() => {
    if (!recurringDetailPeriods || recurringDetailPeriods.length === 0) {
      return null;
    }

    const timings = [...new Set(recurringDetailPeriods.map((detail) => detail.billingTiming).filter(Boolean))];
    return timings.length === 1 ? timings[0] ?? null : null;
  })();

  return {
    recurringDetailPeriods,
    servicePeriodStart,
    servicePeriodEnd,
    billingTiming,
  };
}

function buildPreviewViewModelItem(item: IInvoiceCharge) {
  const recurringSummary = resolvePreviewRecurringSummary(item);
  return {
    id: item.item_id,
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unit_price,
    total: item.total_price,
    servicePeriodStart: recurringSummary.servicePeriodStart,
    servicePeriodEnd: recurringSummary.servicePeriodEnd,
    billingTiming: recurringSummary.billingTiming,
    recurringDetailPeriods: recurringSummary.recurringDetailPeriods,
  };
}

function hasPersistedInvoiceContent(billingResult: IBillingResult): boolean {
  return (
    (billingResult.charges?.length ?? 0) > 0 ||
    (billingResult.discounts?.length ?? 0) > 0 ||
    (billingResult.adjustments?.length ?? 0) > 0
  );
}

type ProjectCapPersistenceDelta = {
  configId: string;
  projectId: string;
  cap: number;
  billedAfter: number;
  billed: number;
  writtenDown: number;
  notifiedThresholds: number[];
};

async function prepareProjectCapChargesForPersistence(
  trx: Knex.Transaction,
  charges: IBillingCharge[],
): Promise<ProjectCapPersistenceDelta[]> {
  const chargesByConfig = new Map<string, Array<ITimeBasedCharge & {
    project_billing_config_id: string;
    project_cap_original_amount?: number;
  }>>();

  for (const charge of charges) {
    const candidate = charge as ITimeBasedCharge & {
      project_billing_config_id?: string;
      project_cap_original_amount?: number;
    };
    if (candidate.type !== 'time' || !candidate.project_billing_config_id) {
      continue;
    }
    const grouped = chargesByConfig.get(candidate.project_billing_config_id) ?? [];
    grouped.push(candidate as ITimeBasedCharge & {
      project_billing_config_id: string;
      project_cap_original_amount?: number;
    });
    chargesByConfig.set(candidate.project_billing_config_id, grouped);
  }

  const deltas: ProjectCapPersistenceDelta[] = [];
  for (const [configId, configCharges] of chargesByConfig) {
    const config = await ProjectBillingConfig.getById(configId, trx);
    if (!config || config.cap_amount === null || config.cap_behavior === null) {
      continue;
    }

    await ProjectBillingCapUsage.ensureRow(configId, trx);
    const usage = await ProjectBillingCapUsage.getForUpdate(configId, trx);
    if (!usage) {
      throw new Error(`Project billing cap usage ${configId} could not be locked`);
    }

    const previousBilled = usage.billed_amount;
    let runningBilled = previousBilled;
    let billedDelta = 0;
    let writtenDownDelta = 0;

    for (const charge of configCharges) {
      const originalAmount = charge.project_cap_original_amount
        ?? charge.total + (charge.write_down_amount ?? 0);
      charge.project_cap_original_amount = originalAmount;

      if (config.cap_behavior === 'hard_cap') {
        const result = computeCapWriteDown(
          config.cap_amount,
          runningBilled,
          originalAmount,
        );
        charge.total = result.billable;
        charge.write_down_amount = result.writtenDown;
        charge.write_down_reason = result.writtenDown > 0 ? 'project_cap' : undefined;
        runningBilled += result.billable;
        billedDelta += result.billable;
        writtenDownDelta += result.writtenDown;
      } else {
        charge.total = originalAmount;
        charge.write_down_amount = 0;
        charge.write_down_reason = undefined;
        runningBilled += originalAmount;
        billedDelta += originalAmount;
      }
    }

    const notifiedThresholds = config.cap_behavior === 'notify'
      ? detectThresholdCrossings(
          config.cap_amount,
          previousBilled,
          runningBilled,
          config.cap_notify_thresholds,
          usage.notified_thresholds,
        )
      : [];

    await ProjectBillingCapUsage.increment(
      configId,
      { billed: billedDelta, writtenDown: writtenDownDelta },
      trx,
    );
    for (const threshold of notifiedThresholds) {
      await ProjectBillingCapUsage.recordNotifiedThreshold(configId, threshold, trx);
    }

    deltas.push({
      configId,
      projectId: config.project_id,
      cap: config.cap_amount,
      billedAfter: runningBilled,
      billed: billedDelta,
      writtenDown: writtenDownDelta,
      notifiedThresholds,
    });
  }

  return deltas;
}

async function persistProjectScheduleCharges(
  trx: Knex.Transaction,
  invoiceId: string,
  charges: IBillingCharge[],
  client: IClient,
  tenant: string,
  userId: string,
): Promise<number> {
  if (charges.length === 0) {
    return 0;
  }

  let subtotal = 0;
  const now = Temporal.Now.instant().toString();
  const exportServiceIds = await ensureProjectScheduleExportServices(trx, tenant);

  for (const charge of charges) {
    const projectCharge = charge as IBillingCharge & {
      schedule_entry_id: string;
    };
    const itemId = uuidv4();
    await tenantDb(trx, tenant).table('invoice_charges').insert({
      item_id: itemId,
      invoice_id: invoiceId,
      service_id: charge.serviceId ?? exportServiceIds[charge.type as 'project_milestone' | 'project_deposit'],
      description: charge.serviceName,
      quantity: charge.quantity ?? 1,
      unit_price: charge.rate,
      net_amount: charge.total,
      tax_amount: charge.tax_amount || 0,
      tax_region: charge.tax_region || client.tax_region,
      tax_rate: charge.tax_rate || 0,
      total_price: charge.total + (charge.tax_amount || 0),
      is_manual: false,
      is_discount: false,
      is_taxable: charge.is_taxable ?? false,
      created_by: userId,
      created_at: now,
      tenant,
    });

    const transitioned = await ProjectBillingScheduleEntry.transitionStatus(
      projectCharge.schedule_entry_id,
      'approved',
      'invoiced',
      {
        invoice_id: invoiceId,
        invoice_charge_id: itemId,
      },
      trx,
    );
    if (!transitioned) {
      throw new Error(
        `Project billing schedule entry ${projectCharge.schedule_entry_id} is no longer approved`,
      );
    }
    subtotal += charge.total;
  }

  return subtotal;
}

async function ensureProjectScheduleExportServices(
  trx: Knex.Transaction,
  tenant: string,
): Promise<Record<'project_milestone' | 'project_deposit', string>> {
  await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`project-billing-export-services:${tenant}`]);
  const db = tenantDb(trx, tenant);
  let serviceType = await db.table('service_types')
    .where({ name: 'Project Billing' })
    .first('id');
  if (!serviceType) {
    const maxOrder = await db.table('service_types').max({ max_order: 'order_number' }).first();
    [serviceType] = await db.table('service_types').insert({
      id: uuidv4(),
      tenant,
      name: 'Project Billing',
      description: 'System services used to map project billing charges to accounting items',
      is_active: true,
      order_number: Number(maxOrder?.max_order ?? 0) + 1,
    }).returning('id');
  }

  const definitions = [
    {
      chargeType: 'project_milestone' as const,
      serviceName: 'Project Milestone',
      description: 'Project milestone billing charge',
    },
    {
      chargeType: 'project_deposit' as const,
      serviceName: 'Project Deposit',
      description: 'Project deposit billing charge',
    },
  ];
  const result = {} as Record<'project_milestone' | 'project_deposit', string>;
  for (const definition of definitions) {
    let service = await db.table('service_catalog')
      .where({
        service_name: definition.serviceName,
        item_kind: 'service',
        custom_service_type_id: serviceType.id,
      })
      .first('service_id');
    if (!service) {
      [service] = await db.table('service_catalog').insert({
        service_id: uuidv4(),
        tenant,
        service_name: definition.serviceName,
        description: definition.description,
        custom_service_type_id: serviceType.id,
        billing_method: 'fixed',
        default_rate: 0,
        unit_of_measure: 'Each',
        item_kind: 'service',
        is_active: true,
      }).returning('service_id');
    }
    result[definition.chargeType] = String(service.service_id);
  }
  return result;
}

type RecurringBridgeMetadata = {
  billingCycleId?: string | null;
};

function resolveRecurringInvoiceBridgeId(bridgeMetadata?: RecurringBridgeMetadata | null): string | null {
  return bridgeMetadata?.billingCycleId ?? null;
}

function normalizeRecurringWindowDate(value: ISO8601String): ISO8601String {
  return toISODate(toPlainDate(value));
}

function buildRecurringWindowErrorContext(
  selectorInput: IRecurringDueSelectionInput,
) {
  return {
    executionIdentityKey: selectorInput.executionWindow.identityKey,
  };
}

function withRecurringWindowErrorContext<T extends Error>(
  error: T,
  selectorInput: IRecurringDueSelectionInput,
): T {
  Object.assign(error, buildRecurringWindowErrorContext(selectorInput));
  return error;
}

function buildPreviewInvoiceFailure(
  selectorInput: IRecurringDueSelectionInput,
  error: string,
): PreviewInvoiceResponse {
  return {
    success: false,
    error,
    ...buildRecurringWindowErrorContext(selectorInput),
  };
}

function previewInvoiceErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'An error occurred while previewing the invoice';
  }

  const { message } = error;
  if (message.startsWith('Permission denied:')) {
    return message;
  }

  if (message.startsWith('Recurring service periods were not materialized')) {
    return message;
  }

  if (/^Billing cycle .+ not found for client .+$/.test(message)) {
    return 'Billing cycle not found';
  }

  if (/^Billing cycle .+ has invalid dates/.test(message)) {
    return 'Billing cycle has invalid dates';
  }

  if (/^Billing Error: Client .+ has active contracts in multiple currencies \(.+\)\. Mixed currency billing is not supported\.$/.test(message)) {
    return 'This client has active contracts in multiple currencies. Mixed currency billing is not supported.';
  }

  if (/^Client .+ not found in tenant .+$/.test(message)) {
    return 'Client not found';
  }

  const expectedMessages = new Set([
    'Grouped recurring selection inputs must share the same client and invoice window.',
    'Invalid billing cycle dates',
    'Invoice period cannot span billing cycle change',
    'No active contract lines found for this client in the selected billing period.',
    'No recurring execution windows selected',
    'No recurring selections were provided for preview.',
    'Recurring selector input execution window kind is not supported.',
    'Recurring selector input is missing client-cadence assignment identity (schedule key).',
    'Recurring selector input is missing contract-cadence assignment identity (contract line).',
  ]);

  return expectedMessages.has(message)
    ? message
    : 'An error occurred while previewing the invoice';
}

function invoiceGenerationActionErrorFrom(error: unknown): InvoiceGenerationActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied')) {
      return permissionError(error.message);
    }

    if (error.message === 'Billing cycle not found') {
      return actionError('Billing cycle not found. It may have been updated or deleted. Please refresh and try again.');
    }
    if (error.message === 'Invoice not found') {
      return actionError('Invoice not found. It may have been updated or deleted. Please refresh and try again.');
    }
    if (error.message === 'Invalid billing cycle dates') {
      return actionError('Billing cycle has invalid dates. Please review the cycle and try again.');
    }
    if (
      error.message === 'No recurring execution windows selected' ||
      error.message === 'No billing settings found' ||
      error.message === 'Nothing to bill' ||
      error.message === 'Recurring selector input execution window kind is not supported.' ||
      error.message === 'Unable to generate a unique invoice number after multiple attempts.' ||
      error.message.startsWith('Purchase Order is required') ||
      error.message.startsWith('Client ') ||
      error.message.startsWith('Service "') ||
      error.message.startsWith('Invoice already exists for this recurring execution window') ||
      error.message.startsWith('Recurring service periods were not materialized') ||
      error.message.includes('Mixed currency billing is not supported')
    ) {
      return actionError(error.message);
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected invoice values is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '23502') {
    return actionError(`Missing required invoice field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('The selected invoice, client, contract, or billing record no longer exists. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('A conflicting invoice already exists. Please refresh and try again.');
  }

  return null;
}

async function withInvoiceGenerationActionErrors<T>(work: () => Promise<T>): Promise<T | InvoiceGenerationActionError> {
  try {
    return await work();
  } catch (error) {
    const expected = invoiceGenerationActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
}

function buildDuplicateRecurringInvoiceError(input: {
  selectorInput: IRecurringDueSelectionInput;
  invoiceId: string;
}): Error {
  const error = new Error(
    'Invoice already exists for this recurring execution window',
  );

  Object.assign(error, {
    code: DUPLICATE_RECURRING_INVOICE_CODE,
    executionIdentityKey: input.selectorInput.executionWindow.identityKey,
    invoiceId: input.invoiceId,
  });

  return error;
}

async function findExistingRecurringInvoiceForSelectionInput(params: {
  knex: Knex;
  tenant: string;
  selectorInput: IRecurringDueSelectionInput;
}): Promise<{ invoiceId: string } | null> {
  const executionWindow = params.selectorInput.executionWindow;
  if (
    executionWindow.kind === 'client_cadence_window'
    && executionWindow.scheduleKey
    && executionWindow.periodKey
  ) {
    const linkedRow = await withTransaction(params.knex, async (trx: Knex.Transaction) => {
      return tenantDb(trx, params.tenant).table('recurring_service_periods')
        .where({
          cadence_owner: 'client',
          schedule_key: executionWindow.scheduleKey,
          period_key: executionWindow.periodKey,
          invoice_window_start: params.selectorInput.windowStart,
          invoice_window_end: params.selectorInput.windowEnd,
        })
        .whereNotNull('invoice_id')
        .first('invoice_id');
    });

    return linkedRow?.invoice_id ? { invoiceId: linkedRow.invoice_id } : null;
  }

  if (
    executionWindow.kind === 'contract_cadence_window'
    && executionWindow.contractLineId
  ) {
    const linkedRow = await withTransaction(params.knex, async (trx: Knex.Transaction) => {
      return tenantDb(trx, params.tenant).table('recurring_service_periods')
        .where({
          obligation_type: 'contract_line',
          obligation_id: executionWindow.contractLineId,
          invoice_window_start: params.selectorInput.windowStart,
          invoice_window_end: params.selectorInput.windowEnd,
        })
        .whereNotNull('invoice_id')
        .first('invoice_id');
    });

    return linkedRow?.invoice_id ? { invoiceId: linkedRow.invoice_id } : null;
  }

  return null;
}

async function resolveCanonicalClientCadenceSelectorInput(params: {
  knex: Knex;
  tenant: string;
  clientId: string;
  windowStart: ISO8601String;
  windowEnd: ISO8601String;
}): Promise<IRecurringDueSelectionInput> {
  const normalizedWindowStart = normalizeRecurringWindowDate(params.windowStart);
  const normalizedWindowEnd = normalizeRecurringWindowDate(params.windowEnd);

  const recurringServicePeriod = await withTransaction(
    params.knex,
    async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, params.tenant);
      const query = db.table('recurring_service_periods as rsp');
      db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_line_id', 'rsp.obligation_id');
      db.tenantJoin(query, 'contracts as ct', 'ct.contract_id', 'cl.contract_id');
      db.tenantJoin(query, 'clients as c', 'c.client_id', 'ct.owner_client_id');

      return query
        .where({
          'rsp.cadence_owner': 'client',
          'c.client_id': params.clientId,
          'rsp.invoice_window_start': normalizedWindowStart,
          'rsp.invoice_window_end': normalizedWindowEnd,
        })
        .whereIn('rsp.obligation_type', [...POST_DROP_RECURRING_OBLIGATION_TYPES])
        .whereNotIn('rsp.lifecycle_state', ['archived', 'superseded'])
        .orderBy('rsp.service_period_start', 'asc')
        .orderBy('rsp.revision', 'asc')
        .first('rsp.schedule_key', 'rsp.period_key');
    },
  );

  if (!recurringServicePeriod?.schedule_key || !recurringServicePeriod?.period_key) {
    throw new Error(
      'Recurring service periods were not materialized for this client billing schedule window.',
    );
  }

  return buildClientCadenceDueSelectionInput({
    clientId: params.clientId,
    scheduleKey: recurringServicePeriod.schedule_key,
    periodKey: recurringServicePeriod.period_key,
    windowStart: normalizedWindowStart,
    windowEnd: normalizedWindowEnd,
  });
}

/**
 * Resolves every recurring due obligation materialized for a client's billing
 * window (legacy billing-cycle bridge). A client cycle window can contain
 * multiple client-cadence schedules (one per contract line) plus
 * contract-cadence lines whose invoice window coincides with the cycle window;
 * production grouped generation (recurringBillingRunActions) passes one
 * selector input per obligation, and the cycle bridge must do the same or it
 * silently drops every obligation after the first.
 */
async function resolveCanonicalSelectorInputsForClientWindow(params: {
  knex: Knex;
  tenant: string;
  clientId: string;
  windowStart: ISO8601String;
  windowEnd: ISO8601String;
}): Promise<IRecurringDueSelectionInput[]> {
  const normalizedWindowStart = normalizeRecurringWindowDate(params.windowStart);
  const normalizedWindowEnd = normalizeRecurringWindowDate(params.windowEnd);

  const buildWindowRowsQuery = (trx: Knex.Transaction) =>
    (() => {
      const db = tenantDb(trx, params.tenant);
      const query = db.table('recurring_service_periods as rsp');
      db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_line_id', 'rsp.obligation_id');
      db.tenantJoin(query, 'contracts as ct', 'ct.contract_id', 'cl.contract_id');
      db.tenantJoin(query, 'clients as c', 'c.client_id', 'ct.owner_client_id');
      return query;
    })()
      .where({
        'c.client_id': params.clientId,
        'rsp.invoice_window_start': normalizedWindowStart,
        'rsp.invoice_window_end': normalizedWindowEnd,
      })
      .whereNotIn('rsp.lifecycle_state', ['archived', 'superseded'])
      .orderBy('rsp.service_period_start', 'asc')
      .orderBy('rsp.revision', 'asc')
      .select(
        'rsp.cadence_owner',
        'rsp.schedule_key',
        'rsp.period_key',
        'rsp.obligation_id',
        'ct.contract_id',
      );

  const windowRows = await withTransaction(
    params.knex,
    async (trx: Knex.Transaction) => {
      const clientCadenceRows = await buildWindowRowsQuery(trx)
        .where('rsp.cadence_owner', 'client')
        .whereIn('rsp.obligation_type', [...POST_DROP_RECURRING_OBLIGATION_TYPES]);
      const contractCadenceRows = await buildWindowRowsQuery(trx)
        .where('rsp.cadence_owner', 'contract')
        .where('rsp.obligation_type', 'contract_line');
      return [...clientCadenceRows, ...contractCadenceRows];
    },
  );

  const selectorInputs: IRecurringDueSelectionInput[] = [];
  const seenClientCadenceKeys = new Set<string>();
  const seenContractLineIds = new Set<string>();

  for (const row of windowRows) {
    if (row.cadence_owner === 'client') {
      if (!row.schedule_key || !row.period_key) {
        continue;
      }
      const dedupeKey = `${row.schedule_key}::${row.period_key}`;
      if (seenClientCadenceKeys.has(dedupeKey)) {
        continue;
      }
      seenClientCadenceKeys.add(dedupeKey);
      selectorInputs.push(buildClientCadenceDueSelectionInput({
        clientId: params.clientId,
        scheduleKey: row.schedule_key,
        periodKey: row.period_key,
        windowStart: normalizedWindowStart,
        windowEnd: normalizedWindowEnd,
      }));
      continue;
    }

    if (!row.obligation_id || seenContractLineIds.has(row.obligation_id)) {
      continue;
    }
    seenContractLineIds.add(row.obligation_id);
    selectorInputs.push(buildContractCadenceDueSelectionInput({
      clientId: params.clientId,
      contractId: row.contract_id ?? null,
      contractLineId: row.obligation_id,
      windowStart: normalizedWindowStart,
      windowEnd: normalizedWindowEnd,
    }));
  }

  if (selectorInputs.length === 0) {
    throw new Error(
      'Recurring service periods were not materialized for this client billing schedule window.',
    );
  }

  return selectorInputs;
}

async function assertClientCadenceWindowFullyMaterialized(params: {
  knex: Knex;
  tenant: string;
  clientId: string;
  windowStart: ISO8601String;
  windowEnd: ISO8601String;
}): Promise<void> {
  const activeRecurringLineRows = await withTransaction(
    params.knex,
    async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, params.tenant);
      const query = db.table('client_contracts as cc');
      db.tenantJoin(query, 'contracts as ct', 'ct.contract_id', 'cc.contract_id');
      db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_id', 'ct.contract_id');

      return query
        .where({
          'cc.client_id': params.clientId,
          'cc.is_active': true,
          'cl.cadence_owner': 'client',
        })
        .whereNotNull('cl.billing_frequency')
        .whereNotNull('cl.billing_timing')
        .where('cc.start_date', '<', params.windowEnd)
        .where(function () {
          this.where('cc.end_date', '>=', params.windowStart)
            .orWhereNull('cc.end_date');
        })
        .select('cl.contract_line_id');
    },
  );

  const activeRecurringLineIds = Array.from(
    new Set(
      activeRecurringLineRows
        .map((row) => row.contract_line_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  if (activeRecurringLineIds.length === 0) {
    return;
  }

  const materializedRows = await withTransaction(
    params.knex,
    async (trx: Knex.Transaction) =>
      tenantDb(trx, params.tenant).table('recurring_service_periods')
        .where({
          cadence_owner: 'client',
          invoice_window_start: params.windowStart,
          invoice_window_end: params.windowEnd,
        })
        .whereIn('obligation_type', [...POST_DROP_RECURRING_OBLIGATION_TYPES])
        .whereIn('obligation_id', activeRecurringLineIds)
        .whereNotIn('lifecycle_state', ['archived', 'superseded'])
        .select('obligation_id'),
  );

  const materializedLineIds = new Set(
    materializedRows
      .map((row) => row.obligation_id)
      .filter((value): value is string => Boolean(value)),
  );
  const missingLineIds = activeRecurringLineIds.filter(
    (lineId) => !materializedLineIds.has(lineId),
  );

  if (missingLineIds.length > 0) {
    throw new Error(
      'Recurring service periods were not materialized for this recurring execution window.',
    );
  }
}

async function normalizeRecurringSelectorInput(params: {
  knex: Knex;
  tenant: string;
  selectorInput: IRecurringDueSelectionInput;
}): Promise<IRecurringDueSelectionInput> {
  const normalizedWindowStart = normalizeRecurringWindowDate(
    params.selectorInput.windowStart,
  );
  const normalizedWindowEnd = normalizeRecurringWindowDate(
    params.selectorInput.windowEnd,
  );

  if (isUnresolvedSelectorInput(params.selectorInput)) {
    return buildClientCadenceDueSelectionInput({
      clientId: params.selectorInput.clientId,
      scheduleKey: params.selectorInput.executionWindow.scheduleKey ?? '',
      periodKey: params.selectorInput.executionWindow.periodKey ?? '',
      windowStart: normalizedWindowStart,
      windowEnd: normalizedWindowEnd,
    });
  }

  if (params.selectorInput.executionWindow.kind === 'client_cadence_window') {
    const recurringServicePeriod = await withTransaction(
      params.knex,
      async (trx: Knex.Transaction) => {
        const db = tenantDb(trx, params.tenant);
        const query = db.table('recurring_service_periods as rsp');
        db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_line_id', 'rsp.obligation_id');
        db.tenantJoin(query, 'contracts as ct', 'ct.contract_id', 'cl.contract_id');
        db.tenantJoin(query, 'clients as c', 'c.client_id', 'ct.owner_client_id');

        return query
          .where({
            'rsp.cadence_owner': 'client',
            'rsp.schedule_key': params.selectorInput.executionWindow.scheduleKey,
            'rsp.period_key': params.selectorInput.executionWindow.periodKey,
            'rsp.invoice_window_start': normalizedWindowStart,
            'rsp.invoice_window_end': normalizedWindowEnd,
            'c.client_id': params.selectorInput.clientId,
          })
          .whereIn('rsp.obligation_type', [...POST_DROP_RECURRING_OBLIGATION_TYPES])
          .whereNotIn('rsp.lifecycle_state', ['archived', 'superseded'])
          .orderBy('rsp.service_period_start', 'asc')
          .orderBy('rsp.revision', 'asc')
          .first('rsp.schedule_key', 'rsp.period_key');
      },
    );

    if (!recurringServicePeriod?.schedule_key || !recurringServicePeriod?.period_key) {
      throw new Error(
        'Recurring service periods were not materialized for this recurring execution window.',
      );
    }

    await assertClientCadenceWindowFullyMaterialized({
      knex: params.knex,
      tenant: params.tenant,
      clientId: params.selectorInput.clientId,
      windowStart: normalizedWindowStart,
      windowEnd: normalizedWindowEnd,
    });

    return buildClientCadenceDueSelectionInput({
      clientId: params.selectorInput.clientId,
      scheduleKey: recurringServicePeriod.schedule_key,
      periodKey: recurringServicePeriod.period_key,
      windowStart: normalizedWindowStart,
      windowEnd: normalizedWindowEnd,
    });
  }

  if (params.selectorInput.executionWindow.kind === 'contract_cadence_window') {
    const recurringServicePeriod = await withTransaction(
      params.knex,
      async (trx: Knex.Transaction) => {
        const db = tenantDb(trx, params.tenant);
        const query = db.table('recurring_service_periods as rsp');
        db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_line_id', 'rsp.obligation_id');
        db.tenantJoin(query, 'contracts as ct', 'ct.contract_id', 'cl.contract_id');
        db.tenantJoin(query, 'clients as c', 'c.client_id', 'ct.owner_client_id');

        query
          .where({
            'rsp.cadence_owner': 'contract',
            'rsp.obligation_type': 'contract_line',
            'rsp.invoice_window_start': normalizedWindowStart,
            'rsp.invoice_window_end': normalizedWindowEnd,
            'c.client_id': params.selectorInput.clientId,
          })
          .whereNotIn('rsp.lifecycle_state', ['archived', 'superseded']);

        if (params.selectorInput.executionWindow.contractId) {
          query.where({
            'ct.contract_id': params.selectorInput.executionWindow.contractId,
          });
        }

        if (params.selectorInput.executionWindow.contractLineId) {
          query.where({
            'rsp.obligation_id': params.selectorInput.executionWindow.contractLineId,
          });
        }

        return query
          .orderBy('rsp.service_period_start', 'asc')
          .orderBy('rsp.revision', 'asc')
          .first('rsp.obligation_id');
      },
    );

    if (!recurringServicePeriod?.obligation_id) {
      throw new Error(
        'Recurring service periods were not materialized for this recurring execution window.',
      );
    }

    return buildContractCadenceDueSelectionInput({
      clientId: params.selectorInput.clientId,
      contractId: params.selectorInput.executionWindow.contractId ?? null,
      contractLineId:
        params.selectorInput.executionWindow.contractLineId
        ?? recurringServicePeriod.obligation_id,
      windowStart: normalizedWindowStart,
      windowEnd: normalizedWindowEnd,
    });
  }

  return params.selectorInput;
}

// TODO: Move to billingAndTax.ts
async function calculatePreviewTax(
  charges: IBillingCharge[],
  clientId: string,
  cycleEnd: ISO8601String,
  defaultTaxRegion: string
): Promise<number> {
  // Sum the pre-calculated tax amounts from the BillingEngine charges
  // BillingEngine already handles multi-region tax allocation for fixed fees
  // and calculates tax for other charge types.
  let totalTax = 0;
  for (const charge of charges) {
    // Add the tax_amount if it exists and is greater than 0
    if (charge.tax_amount && charge.tax_amount > 0) {
      totalTax += charge.tax_amount;
    }
  }
  console.log(`[calculatePreviewTax] Summed pre-calculated tax: ${totalTax}`);

  return totalTax;
}

function parseClientContractLineIdFromScheduleKey(scheduleKey: string | null | undefined): string | null {
  if (!scheduleKey) {
    return null;
  }

  const match = scheduleKey.match(/:client_contract_line:([^:]+):/);
  return match?.[1] ?? null;
}

function parseUnresolvedSelectionFromScheduleKey(scheduleKey: string | null | undefined): {
  chargeType: 'time' | 'usage';
  recordId: string;
} | null {
  if (!scheduleKey) {
    return null;
  }

  // Keep `non_contract` parse support only for historical schedule keys.
  const match = scheduleKey.match(/:(?:unresolved|non_contract):(time|usage):([^:]+)$/);
  if (!match?.[1] || !match?.[2]) {
    return null;
  }

  return {
    chargeType: match[1] as 'time' | 'usage',
    recordId: match[2],
  };
}

function isUnresolvedSelectorInput(selectorInput: IRecurringDueSelectionInput): boolean {
  if (selectorInput.executionWindow.kind !== 'client_cadence_window') {
    return false;
  }

  return Boolean(
    parseUnresolvedSelectionFromScheduleKey(selectorInput.executionWindow.scheduleKey ?? null),
  );
}

function getSelectedRecurringObligationIdFromSelectorInput(
  selectorInput: IRecurringDueSelectionInput,
): string {
  const executionWindow = selectorInput.executionWindow;
  if (executionWindow.kind === 'client_cadence_window') {
    const nonContractSelection = parseUnresolvedSelectionFromScheduleKey(
      executionWindow.scheduleKey,
    );
    if (nonContractSelection) {
      return `__unresolved__:${nonContractSelection.chargeType}:${nonContractSelection.recordId}`;
    }

    const selectedClientContractLineId = parseClientContractLineIdFromScheduleKey(
      executionWindow.scheduleKey,
    );
    if (!selectedClientContractLineId) {
      throw new Error(
        'Recurring selector input is missing client-cadence assignment identity (schedule key).',
      );
    }
    return selectedClientContractLineId;
  }

  if (executionWindow.kind === 'contract_cadence_window') {
    const selectedContractLineId = executionWindow.contractLineId;
    if (!selectedContractLineId) {
      throw new Error(
        'Recurring selector input is missing contract-cadence assignment identity (contract line).',
      );
    }
    return selectedContractLineId;
  }

  throw new Error('Recurring selector input execution window kind is not supported.');
}

function scopeRecurringTimingSelectionsForSelectorInputs(
  recurringTimingSelections: Record<string, unknown>,
  selectorInputs: IRecurringDueSelectionInput[],
): Record<string, unknown> {
  const matchesObligationId = (obligationId: string, selectedId: string): boolean => {
    return (
      obligationId === selectedId
      || obligationId.endsWith(`:${selectedId}`)
      || obligationId.endsWith(`-${selectedId}`)
    );
  };

  const selectedObligationIds = Array.from(
    new Set(selectorInputs.map(getSelectedRecurringObligationIdFromSelectorInput)),
  );
  const selectedContractObligationIds = selectedObligationIds.filter(
    (obligationId) => !obligationId.startsWith('__unresolved__:'),
  );
  const selectionEntries = Object.entries(recurringTimingSelections ?? {});
  if (selectionEntries.length === 0) {
    return recurringTimingSelections ?? {};
  }

  if (selectedContractObligationIds.length === 0) {
    return {};
  }

  const scoped = Object.fromEntries(
    selectionEntries.filter(([obligationId]) =>
      selectedContractObligationIds.some((selectedId) =>
        matchesObligationId(obligationId, selectedId),
      ),
    ),
  );
  if (Object.keys(scoped).length === 0) {
    throw new Error(
      'Recurring service periods were not materialized for this recurring execution window.',
    );
  }
  return scoped;
}

function assertSameRecurringSelectionWindow(
  selectorInputs: IRecurringDueSelectionInput[],
): IRecurringDueSelectionInput {
  if (selectorInputs.length === 0) {
    throw new Error('No recurring execution windows selected');
  }

  const first = selectorInputs[0];
  const hasMismatchedWindow = selectorInputs.some((selectorInput) =>
    selectorInput.clientId !== first.clientId
    || selectorInput.windowStart !== first.windowStart
    || selectorInput.windowEnd !== first.windowEnd,
  );
  if (hasMismatchedWindow) {
    throw new Error(
      'Grouped recurring selection inputs must share the same client and invoice window.',
    );
  }
  return first;
}

async function resolveApprovalBlockerRowsForSelectorInputs(params: {
  knex: Knex;
  tenant: string;
  selectorInputs: IRecurringDueSelectionInput[];
}): Promise<Array<{
  executionIdentityKey: string;
  clientId: string;
  servicePeriodStart: ISO8601String;
  servicePeriodEnd: ISO8601String;
  contractLineId?: string | null;
  scheduleKey?: string | null;
}>> {
  const canonicalSelection = assertSameRecurringSelectionWindow(params.selectorInputs);
  const resolvedRows: Array<{
    executionIdentityKey: string;
    clientId: string;
    servicePeriodStart: ISO8601String;
    servicePeriodEnd: ISO8601String;
    contractLineId?: string | null;
    scheduleKey?: string | null;
  }> = [];

  const persistedWindowRows = await withTransaction(params.knex, async (trx: Knex.Transaction) => {
    const db = tenantDb(trx, params.tenant);
    const query = db.table('recurring_service_periods as rsp');
    db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_line_id', 'rsp.obligation_id');
    db.tenantJoin(query, 'contracts as ct', 'ct.contract_id', 'cl.contract_id');

    return query
      .where('ct.owner_client_id', canonicalSelection.clientId)
      .where('rsp.invoice_window_start', canonicalSelection.windowStart)
      .where('rsp.invoice_window_end', canonicalSelection.windowEnd)
      .whereIn('rsp.obligation_type', ['contract_line', CLIENT_CADENCE_POST_DROP_OBLIGATION_TYPE])
      .whereIn('rsp.lifecycle_state', [...DEFAULT_RECURRING_SERVICE_PERIOD_DUE_SELECTION_STATES])
      .select('rsp.obligation_id', 'rsp.service_period_start', 'rsp.service_period_end', 'rsp.schedule_key');
  });

  for (const row of persistedWindowRows) {
    resolvedRows.push({
      executionIdentityKey: canonicalSelection.executionWindow.identityKey,
      clientId: canonicalSelection.clientId,
      servicePeriodStart: row.service_period_start,
      servicePeriodEnd: row.service_period_end,
      contractLineId: row.obligation_id ?? null,
      scheduleKey: row.schedule_key ?? null,
    });
  }

  for (const selectorInput of params.selectorInputs) {
    const executionWindow = selectorInput.executionWindow;
    const unresolvedSelection = parseUnresolvedSelectionFromScheduleKey(
      executionWindow.kind === 'client_cadence_window'
        ? executionWindow.scheduleKey ?? null
        : null,
    );

    if (unresolvedSelection?.chargeType === 'time') {
      resolvedRows.push({
        executionIdentityKey: canonicalSelection.executionWindow.identityKey,
        clientId: selectorInput.clientId,
        servicePeriodStart: selectorInput.windowStart,
        servicePeriodEnd: selectorInput.windowEnd,
        scheduleKey: executionWindow.scheduleKey ?? null,
      });
    }
  }

  return resolvedRows;
}

export async function calculateBillingForSelectionInputs(input: {
  billingEngine: BillingEngine;
  selectorInputs: IRecurringDueSelectionInput[];
}) {
  const canonicalSelection = assertSameRecurringSelectionWindow(input.selectorInputs);
  const selectedNonContractSelections = input.selectorInputs
    .map((selectorInput) =>
      parseUnresolvedSelectionFromScheduleKey(
        selectorInput.executionWindow.kind === 'client_cadence_window'
          ? selectorInput.executionWindow.scheduleKey ?? null
          : null,
      ),
    )
    .filter((selection): selection is { chargeType: 'time' | 'usage'; recordId: string } =>
      Boolean(selection),
    );
  const nonContractTimeEntryIds = selectedNonContractSelections
    .filter((selection) => selection.chargeType === 'time')
    .map((selection) => selection.recordId);
  const nonContractUsageRecordIds = selectedNonContractSelections
    .filter((selection) => selection.chargeType === 'usage')
    .map((selection) => selection.recordId);

  const recurringTimingSelections =
    await input.billingEngine.selectDueRecurringServicePeriodsForBillingWindow(
      canonicalSelection.clientId,
      canonicalSelection.windowStart,
      canonicalSelection.windowEnd,
    );
  const scopedRecurringTimingSelections = scopeRecurringTimingSelectionsForSelectorInputs(
    recurringTimingSelections,
    input.selectorInputs,
  );

  return input.billingEngine.calculateBillingForExecutionWindow(
    canonicalSelection.clientId,
    canonicalSelection.windowStart,
    canonicalSelection.windowEnd,
    {
      recurringTimingSelections: scopedRecurringTimingSelections,
      recurringTimingSelectionSource: 'persisted',
      nonContractSelection: {
        include: selectedNonContractSelections.length > 0,
        timeEntryIds: nonContractTimeEntryIds,
        usageRecordIds: nonContractUsageRecordIds,
      },
    },
  );
}

export async function calculateBillingForSelectionInput(input: {
  billingEngine: BillingEngine;
  selectorInput: IRecurringDueSelectionInput;
}) {
  return calculateBillingForSelectionInputs({
    billingEngine: input.billingEngine,
    selectorInputs: [input.selectorInput],
  });
}

export type PurchaseOrderOverageDecision = 'allow' | 'skip';

export type PurchaseOrderOverageResult = {
  client_contract_id: string;
  po_number: string | null;
  authorized_cents: number;
  consumed_cents: number;
  remaining_cents: number;
  invoice_total_cents: number;
  overage_cents: number;
};

async function getPurchaseOrderOverageForSelectionInputInternal(params: {
  knex: Knex;
  tenant: string;
  selectorInput: IRecurringDueSelectionInput;
}): Promise<PurchaseOrderOverageResult | null> {
  const { knex, tenant } = params;
  const selectorInput = await normalizeRecurringSelectorInput(params);
  const client_id = selectorInput.clientId;
  const cycleEnd = selectorInput.windowEnd;

  const billingEngine = new BillingEngine();
  const billingResult = await calculateBillingForSelectionInput({
    billingEngine,
    selectorInput,
  });
  if (billingResult.error) {
    throw new Error(billingResult.error);
  }

  const clientContractId = getSingleClientContractIdFromCharges(billingResult.charges);
  if (!clientContractId) {
    return null;
  }

  const poContext = await getClientContractPurchaseOrderContext({
    knex,
    tenant,
    clientContractId,
  });

  if (poContext.po_amount == null) {
    return null;
  }

  const client = await getClientDetails(knex, tenant, client_id);
  const defaultRegion = await getClientDefaultTaxRegionCode(knex, tenant, client_id);
  const previewTax = await calculatePreviewTax(
    billingResult.charges,
    client_id,
    cycleEnd,
    defaultRegion || client?.tax_region || '',
  );
  const invoiceTotal = Math.trunc(billingResult.totalAmount + previewTax);

  const consumed = await getPurchaseOrderConsumedCents({ knex, tenant, clientContractId });
  const computed = computePurchaseOrderOverage({
    authorizedCents: poContext.po_amount,
    consumedCents: consumed,
    invoiceTotalCents: invoiceTotal,
  });

  return {
    client_contract_id: clientContractId,
    po_number: poContext.po_number,
    authorized_cents: computed.authorizedCents,
    consumed_cents: computed.consumedCents,
    remaining_cents: computed.remainingCents,
    invoice_total_cents: computed.invoiceTotalCents,
    overage_cents: computed.overageCents,
  };
}

export const getPurchaseOrderOverageForSelectionInput = withAuth(async (
  user,
  { tenant },
  selectorInput: IRecurringDueSelectionInput,
): Promise<PurchaseOrderOverageResult | null | InvoiceGenerationActionError> => {
  return withInvoiceGenerationActionErrors(async () => {
  const { knex } = await createTenantKnex();

  if (!await hasPermission(user, 'invoice', 'create') && !await hasPermission(user, 'invoice', 'generate')) {
    throw new Error('Permission denied: Cannot generate invoices');
  }

  return getPurchaseOrderOverageForSelectionInputInternal({
    knex,
    tenant,
    selectorInput,
  });
  });
});

export const getPurchaseOrderOverageForBillingCycle = withAuth(async (
  user,
  { tenant },
  billing_cycle_id: string
): Promise<PurchaseOrderOverageResult | null | InvoiceGenerationActionError> => {
  return withInvoiceGenerationActionErrors(async () => {
  const { knex } = await createTenantKnex();

  const billingCycle = await withTransaction(knex, async (trx: Knex.Transaction) => {
    if (!await hasPermission(user, 'invoice', 'create') && !await hasPermission(user, 'invoice', 'generate')) {
      throw new Error('Permission denied: Cannot generate invoices');
    }

    return await tenantDb(trx, tenant).table('client_billing_cycles')
      .where({ billing_cycle_id })
      .first();
  });

  if (!billingCycle) {
    throw new Error('Billing cycle not found');
  }

  const { client_id, period_start_date, period_end_date, effective_date } = billingCycle;

  let cycleStart: ISO8601String;
  let cycleEnd: ISO8601String;

  if (period_start_date && period_end_date) {
    cycleStart = toISOTimestamp(toPlainDate(period_start_date));
    cycleEnd = toISOTimestamp(toPlainDate(period_end_date));
  } else if (effective_date) {
    const effectiveDateUTC = toISOTimestamp(toPlainDate(effective_date));
    cycleStart = effectiveDateUTC;
    cycleEnd = unwrapBillingHelperResult(await getNextBillingDate(client_id, effectiveDateUTC));
  } else {
    throw new Error('Invalid billing cycle dates');
  }

  return getPurchaseOrderOverageForSelectionInputInternal({
    knex,
    tenant,
    selectorInput: await resolveCanonicalClientCadenceSelectorInput({
      knex,
      tenant,
      clientId: client_id,
      windowStart: cycleStart,
      windowEnd: cycleEnd,
    }),
  });
  });
});

// TODO: Move to billingAndTax.ts
async function calculateChargeDetails(
  charge: IBillingCharge,
  clientId: string,
  endDate: ISO8601String,
  taxService: TaxService,
  defaultTaxRegion: string
): Promise<{ netAmount: number; taxCalculationResult: ITaxCalculationResult }> {
  let netAmount: number;

  if ('overageHours' in charge && 'overageRate' in charge) {
    const bucketCharge = charge as IBucketCharge;
    netAmount = bucketCharge.overageHours > 0 ? Math.ceil(bucketCharge.total) : 0;
  } else {
    netAmount = Math.ceil(charge.total);
  }

  let taxCalculationResult: ITaxCalculationResult;

  // Check if it's a fixed price charge with pre-calculated tax
  if (isFixedPriceCharge(charge) && charge.tax_amount !== undefined && charge.tax_rate !== undefined) {
    // Use the pre-calculated tax from BillingEngine for fixed fee charges
    taxCalculationResult = {
      taxAmount: charge.tax_amount,
      taxRate: charge.tax_rate,
    };
  } else {
    // Otherwise, calculate tax (for time, usage, etc., or if fixed fee somehow missed pre-calc)
    taxCalculationResult = charge.is_taxable !== false && netAmount > 0
      ? await taxService.calculateTax(
        clientId,
        netAmount,
        endDate,
        charge.tax_region || defaultTaxRegion
      )
      : { taxAmount: 0, taxRate: 0 };
  }
  return { netAmount, taxCalculationResult };
}

// TODO: Move to billingAndTax.ts
function getPaymentTermDays(paymentTerms: string): number {
  switch (paymentTerms) {
    case 'net_30':
      return 30;
    case 'net_15':
      return 15;
    case 'due_on_receipt':
      return 0;
    default:
      return 30; // Default to 30 days if unknown payment term
  }
}

// Adapter function to convert data to WasmInvoiceViewModel
async function adaptToWasmViewModel(
  billingResult: IBillingResult,
  client: IClientWithLocation | null,
  invoiceItems: IInvoiceCharge[],
  dueDate: string,
  previewTax: number,
  tenant: string | null // Added tenant for fetching tenant client info
): Promise<WasmInvoiceViewModel> {
  // Fetch Tenant Client Info (similar logic to getFullInvoiceById)
  let tenantClientInfo: { name: any; address: any; logoUrl: string | null } | null = null;
  let poNumber: string | null = null;
  if (tenant) {
    const { knex } = await createTenantKnex(tenant); // Get knex instance again if needed
    const tenantClientLink = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table('tenant_companies')
        .where({ is_default: true })
        .select('client_id')
        .first();
    });

    if (tenantClientLink) {
      const tenantClientDetails = await withTransaction(knex, async (trx: Knex.Transaction) => {
        const db = tenantDb(trx, tenant);
        const query = db.table('clients as c');
        db.tenantJoin(query, 'client_locations as cl', 'c.client_id', 'cl.client_id', {
          type: 'left',
          on(join) {
            join.andOn('cl.is_default', '=', trx.raw('true'));
          },
        });

        return await query
          .select(
            'c.client_name',
            'cl.address_line1 as address'
          )
          .where({
            'c.client_id': tenantClientLink.client_id,
          })
          .first();
      });

      if (tenantClientDetails) {
        const logoUrl = await getClientLogoUrl(tenantClientLink.client_id, tenant);
        tenantClientInfo = {
          name: tenantClientDetails.client_name,
          address: tenantClientDetails.address || 'N/A',
          logoUrl: logoUrl || null, // Use null if logoUrl is empty/null
        };
      }
    }

    const clientContractId = getSingleClientContractIdFromCharges(billingResult.charges);
    if (clientContractId) {
      poNumber = (await getClientContractPurchaseOrderContext({ knex, tenant, clientContractId })).po_number;
    }
  }

  const previewViewModelItems = invoiceItems.map(buildPreviewViewModelItem);

  return {
    invoiceNumber: 'PREVIEW',
    issueDate: toISODate(Temporal.Now.plainDateISO()),
    dueDate: dueDate,
    currencyCode: billingResult.currency_code || 'USD',
    poNumber,
    customer: {
      name: client?.client_name || 'N/A',
      address: client?.location_address || 'N/A',
    },
    tenantClient: tenantClientInfo, // Use fetched tenant client info
    items: previewViewModelItems,
    subtotal: billingResult.totalAmount,
    tax: previewTax,
    total: billingResult.totalAmount + previewTax,
    // notes: undefined, // Add if needed
  };
}

async function buildPreviewInvoiceForSelectionInputs(params: {
  knex: Knex;
  tenant: string;
  selectorInputs: IRecurringDueSelectionInput[];
}): Promise<WasmInvoiceViewModel> {
  const { knex, tenant, selectorInputs } = params;
  const canonicalSelection = assertSameRecurringSelectionWindow(selectorInputs);
  const client_id = canonicalSelection.clientId;
  const cycleEnd = canonicalSelection.windowEnd;
  const previewInvoiceKey = selectorInputs
    .map((selectorInput) => selectorInput.executionWindow.identityKey)
    .sort()
    .join('|');

  const clientForValidation = await tenantDb(knex, tenant).table('clients')
    .where({ client_id })
    .select('client_name')
    .first();

  if (clientForValidation) {
    const emailValidation = await validateClientBillingEmail(
      knex,
      tenant,
      client_id,
      clientForValidation.client_name,
    );
    if (!emailValidation.valid) {
      throw withRecurringWindowErrorContext(new Error(emailValidation.error!), canonicalSelection);
    }
  }

  const billingEngine = new BillingEngine();
  const billingResult = await calculateBillingForSelectionInputs({
    billingEngine,
    selectorInputs,
  });

  if (billingResult.error) {
    throw withRecurringWindowErrorContext(new Error(billingResult.error), canonicalSelection);
  }

  if (billingResult.charges.length === 0) {
    throw withRecurringWindowErrorContext(new Error('Nothing to bill'), canonicalSelection);
  }

  const client = await getClientDetails(knex, tenant, client_id);
  const previewInvoiceDate = Temporal.Now.plainDateISO().toString();
  const due_date = unwrapBillingHelperResult(await getDueDate(client_id, previewInvoiceDate));
  const chargesByContractGroup: { [key: string]: IBillingCharge[] } = {};
  const chargesByProjectGroup: { [key: string]: IBillingCharge[] } = {};
  const nonContractAssociatedCharges: IBillingCharge[] = [];

  for (const charge of billingResult.charges) {
    const projectMetadata = getProjectChargeMetadata(charge);
    if (projectMetadata) {
      if (!chargesByProjectGroup[projectMetadata.projectId]) {
        chargesByProjectGroup[projectMetadata.projectId] = [];
      }
      chargesByProjectGroup[projectMetadata.projectId].push(charge);
    } else if (charge.client_contract_id && charge.contract_name) {
      const contractKey = charge.contract_name;
      if (!chargesByContractGroup[contractKey]) {
        chargesByContractGroup[contractKey] = [];
      }
      chargesByContractGroup[contractKey].push(charge);
    } else {
      nonContractAssociatedCharges.push(charge);
    }
  }

  const invoiceItems: IInvoiceCharge[] = [];

  nonContractAssociatedCharges.forEach(charge => {
    const recurringSummary = resolvePreviewRecurringSummary(charge);
    invoiceItems.push({
      item_id: 'preview-' + uuidv4(),
      invoice_id: `preview-${previewInvoiceKey}`,
      service_id: charge.serviceId,
      description: charge.serviceName || 'Charge',
      quantity: getChargeQuantity(charge),
      unit_price: getChargeUnitPrice(charge),
      total_price: charge.total,
      tax_amount: charge.tax_amount || 0,
      tax_rate: charge.tax_rate || 0,
      tax_region: charge.tax_region || '',
      net_amount: charge.total - (charge.tax_amount || 0),
      is_manual: false,
      rate: charge.rate,
      service_period_start: recurringSummary.servicePeriodStart,
      service_period_end: recurringSummary.servicePeriodEnd,
      billing_timing: recurringSummary.billingTiming,
      recurring_detail_periods: recurringSummary.recurringDetailPeriods?.map((period) => ({
        service_period_start: period.servicePeriodStart ?? null,
        service_period_end: period.servicePeriodEnd ?? null,
        billing_timing: period.billingTiming ?? null,
      })),
    });
  });

  for (const [contractKey, charges] of Object.entries(chargesByContractGroup)) {
    const contractGroupName = contractKey;
    const clientContractGroupId = charges[0].client_contract_id;
    const contractGroupHeaderId = 'preview-' + uuidv4();
    invoiceItems.push({
      item_id: contractGroupHeaderId,
      invoice_id: `preview-${previewInvoiceKey}`,
      description: `Contract: ${contractGroupName}`,
      quantity: 1,
      unit_price: 0,
      total_price: 0,
      net_amount: 0,
      tax_amount: 0,
      tax_rate: 0,
      is_manual: false,
      is_bundle_header: true,
      client_contract_id: clientContractGroupId,
      contract_name: contractGroupName,
      rate: 0
    });

    charges.forEach(charge => {
      const recurringSummary = resolvePreviewRecurringSummary(charge);
      let description = charge.serviceName;
      if (isBucketCharge(charge)) {
        const currencySymbol = getCurrencySymbol(billingResult.currency_code || 'USD');
        if (charge.isUsageBucket) {
          const unitLabel = charge.unitOfMeasure?.trim() || 'units';
          const unitsUsed = charge.unitsUsed ?? charge.hoursUsed;
          const overageUnits = charge.overageUnits ?? charge.quantity ?? 0;
          const unitsIncluded = charge.includedUnits ?? Math.max(0, unitsUsed - overageUnits);
          if (overageUnits > 0) {
            description = `${charge.serviceName} - ${unitsUsed.toFixed(2)} ${unitLabel} used (${unitsIncluded.toFixed(2)} ${unitLabel} included + ${overageUnits.toFixed(2)} ${unitLabel} overage @ ${currencySymbol}${(charge.overageRate / 100).toFixed(2)}/${unitLabel})`;
          } else {
            description = `${charge.serviceName} - ${unitsUsed.toFixed(2)} ${unitLabel} used (within ${unitsIncluded.toFixed(2)} ${unitLabel} included)`;
          }
        } else {
          const hoursIncluded = charge.hoursUsed - charge.overageHours;
          if (charge.overageHours > 0) {
            description = `${charge.serviceName} - ${charge.hoursUsed.toFixed(2)} hrs used (${hoursIncluded.toFixed(2)} hrs included + ${charge.overageHours.toFixed(2)} hrs overage @ ${currencySymbol}${(charge.overageRate / 100).toFixed(2)}/hr)`;
          } else {
            description = `${charge.serviceName} - ${charge.hoursUsed.toFixed(2)} hrs used (within ${hoursIncluded.toFixed(2)} hrs included)`;
          }
        }
      }

      invoiceItems.push({
        item_id: 'preview-' + uuidv4(),
        invoice_id: `preview-${previewInvoiceKey}`,
        service_id: charge.serviceId,
        description: description,
        quantity: getChargeQuantity(charge),
        unit_price: getChargeUnitPrice(charge),
        total_price: charge.total,
        tax_amount: charge.tax_amount || 0,
        tax_rate: charge.tax_rate || 0,
        tax_region: charge.tax_region || '',
        net_amount: charge.total - (charge.tax_amount || 0),
        is_manual: false,
        client_contract_id: clientContractGroupId,
        contract_name: contractGroupName,
        parent_item_id: contractGroupHeaderId,
        rate: charge.rate,
        service_period_start: recurringSummary.servicePeriodStart,
        service_period_end: recurringSummary.servicePeriodEnd,
        billing_timing: recurringSummary.billingTiming,
        recurring_detail_periods: recurringSummary.recurringDetailPeriods?.map((period) => ({
          service_period_start: period.servicePeriodStart ?? null,
          service_period_end: period.servicePeriodEnd ?? null,
          billing_timing: period.billingTiming ?? null,
        })),
      });
    });
  }

  for (const charges of Object.values(chargesByProjectGroup)) {
    const metadata = getProjectChargeMetadata(charges[0]);
    if (!metadata) continue;

    const projectGroupHeaderId = 'preview-' + uuidv4();
    invoiceItems.push({
      item_id: projectGroupHeaderId,
      invoice_id: `preview-${previewInvoiceKey}`,
      description: `Project: ${metadata.projectName}`,
      quantity: 1,
      unit_price: 0,
      total_price: 0,
      net_amount: 0,
      tax_amount: 0,
      tax_rate: 0,
      is_manual: false,
      is_bundle_header: true,
      rate: 0,
    });

    charges.forEach((charge) => {
      const recurringSummary = resolvePreviewRecurringSummary(charge);
      invoiceItems.push({
        item_id: 'preview-' + uuidv4(),
        invoice_id: `preview-${previewInvoiceKey}`,
        service_id: charge.serviceId,
        description: charge.serviceName || 'Project charge',
        quantity: getChargeQuantity(charge),
        unit_price: getChargeUnitPrice(charge),
        total_price: charge.total,
        tax_amount: charge.tax_amount || 0,
        tax_rate: charge.tax_rate || 0,
        tax_region: charge.tax_region || '',
        net_amount: charge.total - (charge.tax_amount || 0),
        is_manual: false,
        parent_item_id: projectGroupHeaderId,
        rate: charge.rate,
        service_period_start: recurringSummary.servicePeriodStart,
        service_period_end: recurringSummary.servicePeriodEnd,
        billing_timing: recurringSummary.billingTiming,
        recurring_detail_periods: recurringSummary.recurringDetailPeriods?.map((period) => ({
          service_period_start: period.servicePeriodStart ?? null,
          service_period_end: period.servicePeriodEnd ?? null,
          billing_timing: period.billingTiming ?? null,
        })),
      });
    });
  }

  const previewTax = await calculatePreviewTax(
    billingResult.charges,
    client_id,
    cycleEnd,
    client?.tax_region || '',
  );

  return adaptToWasmViewModel(
    billingResult,
    client,
    invoiceItems,
    due_date,
    previewTax,
    tenant,
  );
}

async function buildPreviewInvoiceForSelectionInput(params: {
  knex: Knex;
  tenant: string;
  selectorInput: IRecurringDueSelectionInput;
}): Promise<WasmInvoiceViewModel> {
  return buildPreviewInvoiceForSelectionInputs({
    knex: params.knex,
    tenant: params.tenant,
    selectorInputs: [params.selectorInput],
  });
}

export type RecurringGroupedPreviewSelectionInput = {
  previewGroupKey: string;
  selectorInputs: IRecurringDueSelectionInput[];
};

export type RecurringGroupedPreviewResponse = {
  success: true;
  invoiceCount: number;
  previews: Array<{
    previewGroupKey: string;
    data: WasmInvoiceViewModel;
    selectorInputs: IRecurringDueSelectionInput[];
  }>;
} | {
  success: false;
  error: string;
  executionIdentityKey?: string;
};

export const previewGroupedInvoicesForSelectionInputs = withAuth(async (
  user,
  { tenant },
  groupedSelections: RecurringGroupedPreviewSelectionInput[],
): Promise<RecurringGroupedPreviewResponse> => {
  const { knex } = await createTenantKnex();
  let normalizedGroupedSelections = groupedSelections;

  try {
    if (!await hasPermission(user, 'invoice', 'create') && !await hasPermission(user, 'invoice', 'generate')) {
      throw new Error('Permission denied: Cannot preview invoices');
    }
    if (!Array.isArray(groupedSelections) || groupedSelections.length === 0) {
      throw new Error('No recurring selections were provided for preview.');
    }

    normalizedGroupedSelections = await Promise.all(
      groupedSelections.map(async (group) => ({
        previewGroupKey: group.previewGroupKey,
        selectorInputs: await Promise.all(
          (group.selectorInputs ?? []).map((selectorInput) =>
            normalizeRecurringSelectorInput({
              knex,
              tenant,
              selectorInput,
            }),
          ),
        ),
      })),
    );

    const previews = await Promise.all(
      normalizedGroupedSelections.map(async (group) => ({
        previewGroupKey: group.previewGroupKey,
        selectorInputs: group.selectorInputs,
        data: await buildPreviewInvoiceForSelectionInputs({
          knex,
          tenant,
          selectorInputs: group.selectorInputs,
        }),
      })),
    );

    return {
      success: true,
      invoiceCount: previews.length,
      previews,
    };
  } catch (error) {
    const fallbackSelectorInput = normalizedGroupedSelections[0]?.selectorInputs?.[0];
    return fallbackSelectorInput
      ? buildPreviewInvoiceFailure(
          fallbackSelectorInput,
          previewInvoiceErrorMessage(error),
        )
      : {
          success: false,
          error: previewInvoiceErrorMessage(error),
        };
  }
});

export const previewInvoiceForSelectionInput = withAuth(async (
  user,
  { tenant },
  selectorInput: IRecurringDueSelectionInput,
): Promise<PreviewInvoiceResponse> => {
  const { knex } = await createTenantKnex();
  let normalizedSelectorInput = selectorInput;

  try {
    if (!await hasPermission(user, 'invoice', 'create') && !await hasPermission(user, 'invoice', 'generate')) {
      throw new Error('Permission denied: Cannot preview invoices');
    }
    normalizedSelectorInput = await normalizeRecurringSelectorInput({
      knex,
      tenant,
      selectorInput,
    });
    return {
      success: true,
      data: await buildPreviewInvoiceForSelectionInput({
        knex,
        tenant,
        selectorInput: normalizedSelectorInput,
      }),
    };
  } catch (error) {
    return buildPreviewInvoiceFailure(
      normalizedSelectorInput,
      previewInvoiceErrorMessage(error),
    );
  }
});

export const previewInvoice = withAuth(async (
  user,
  { tenant },
  billing_cycle_id: string
): Promise<PreviewInvoiceResponse> => {
  const { knex } = await createTenantKnex();
  let selectorInput: IRecurringDueSelectionInput | null = null;

  try {
    if (!await hasPermission(user, 'invoice', 'create') && !await hasPermission(user, 'invoice', 'generate')) {
      throw new Error('Permission denied: Cannot preview invoices');
    }

    const billingCycle = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table('client_billing_cycles')
        .where({
          billing_cycle_id,
        })
        .first();
    });

    if (!billingCycle) {
      return {
        success: false,
        error: 'Invalid billing cycle'
      };
    }

    const { client_id, period_start_date, period_end_date, effective_date } = billingCycle;

    let cycleStart: ISO8601String;
    let cycleEnd: ISO8601String;

    if (period_start_date && period_end_date) {
      cycleStart = normalizeRecurringWindowDate(period_start_date);
      cycleEnd = normalizeRecurringWindowDate(period_end_date);
    } else if (effective_date) {
      cycleStart = normalizeRecurringWindowDate(effective_date);
      cycleEnd = normalizeRecurringWindowDate(
        unwrapBillingHelperResult(await getNextBillingDate(client_id, cycleStart)),
      );
    } else {
      throw new Error('Invalid billing cycle dates');
    }

    selectorInput = await resolveCanonicalClientCadenceSelectorInput({
      knex,
      tenant,
      clientId: client_id,
      windowStart: cycleStart,
      windowEnd: cycleEnd,
    });

    return {
      success: true,
      data: await buildPreviewInvoiceForSelectionInput({
        knex,
        tenant,
        selectorInput,
      })
    };
  } catch (error) {
    return selectorInput
      ? buildPreviewInvoiceFailure(
          selectorInput,
          previewInvoiceErrorMessage(error),
        )
      : {
          success: false,
          error: previewInvoiceErrorMessage(error)
        };
  }
});

// Update return type to the interface InvoiceViewModel
export const generateProjectInvoice = withAuth(async (
  user,
  { tenant },
  projectId: string,
  entryIds?: string[],
): Promise<{ invoice_id: string }> => {
  if (!await hasPermission(user, 'invoice', 'create') && !await hasPermission(user, 'invoice', 'generate')) {
    throw new Error('Permission denied: Cannot generate invoices');
  }

  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenant);
  const projectQuery = db.table('projects as project');
  db.tenantJoin(projectQuery, 'project_billing_configs as config', 'project.project_id', 'config.project_id');
  const project = await projectQuery
    .where('project.project_id', projectId)
    .select(
      'project.project_id',
      'project.client_id',
      'project.start_date',
      'project.created_at',
      'config.invoice_mode',
    )
    .first();

  if (!project) {
    throw new Error('Project billing configuration not found');
  }
  if (project.invoice_mode !== 'standalone') {
    throw new Error('Project is configured for recurring invoice generation');
  }

  const billingEngine = new BillingEngine();
  const billingResult = await billingEngine.calculateProjectBilling(projectId, entryIds);
  if (billingResult.error) {
    throw new Error(billingResult.error);
  }
  if (billingResult.charges.length === 0) {
    throw new Error('Nothing to bill');
  }

  const cycleStart = toISOTimestamp(toPlainDate(project.start_date ?? project.created_at));
  const cycleEnd = toISOTimestamp(Temporal.Now.plainDateISO().add({ days: 1 }));
  const createdInvoice = await createInvoiceFromBillingResult(
    billingResult,
    project.client_id,
    cycleStart,
    cycleEnd,
    null,
    user.user_id,
    { projectId },
  );

  return { invoice_id: createdInvoice.invoice_id };
});

export const generateInvoice = withAuth(async (
  user,
  { tenant },
  billing_cycle_id: string,
  options: { allowPoOverage?: boolean } = {}
): Promise<InvoiceViewModel | null | InvoiceGenerationActionError> => {
  return withInvoiceGenerationActionErrors(async () => {
  // Get billing cycle details
  const { knex } = await createTenantKnex();

  const billingCycle = await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Check permissions within transaction
    if (!await hasPermission(user, 'invoice', 'create') && !await hasPermission(user, 'invoice', 'generate')) {
      throw new Error('Permission denied: Cannot generate invoices');
    }

    return await tenantDb(trx, tenant).table('client_billing_cycles')
      .where({
        billing_cycle_id,
      })
      .first();
  });

  if (!billingCycle) {
    throw new Error('Billing cycle not found');
  }

  const { client_id, period_start_date, period_end_date, effective_date } = billingCycle;

  let cycleStart: ISO8601String;
  let cycleEnd: ISO8601String;

  if (period_start_date && period_end_date) {
    cycleStart = normalizeRecurringWindowDate(period_start_date);
    cycleEnd = normalizeRecurringWindowDate(period_end_date);
  } else if (effective_date) {
    cycleStart = normalizeRecurringWindowDate(effective_date);
    cycleEnd = normalizeRecurringWindowDate(
      unwrapBillingHelperResult(await getNextBillingDate(client_id, cycleStart)),
    );
  } else {
    throw new Error('Invalid billing cycle dates');
  }

  // Resolve every materialized obligation in this cycle window (multiple
  // client-cadence schedules and same-window contract-cadence lines), matching
  // how grouped recurring generation invoices a window. Resolving only the
  // first schedule key would silently drop the remaining contract lines.
  const selectorInputs = await resolveCanonicalSelectorInputsForClientWindow({
    knex,
    tenant,
    clientId: client_id,
    windowStart: cycleStart,
    windowEnd: cycleEnd,
  });

  let normalizedSelectorInputs: IRecurringDueSelectionInput[];
  try {
    normalizedSelectorInputs = await Promise.all(
      selectorInputs.map((selectorInput) =>
        normalizeRecurringSelectorInput({
          knex,
          tenant,
          selectorInput,
        }),
      ),
    );
  } catch (error) {
    throw withRecurringWindowErrorContext(
      error instanceof Error
        ? error
        : new Error('An error occurred while validating the recurring execution window.'),
      selectorInputs[0],
    );
  }

  return generateInvoiceForNormalizedSelectionInputs({
    user,
    tenant,
    knex,
    normalizedSelectorInputs,
    options,
    bridgeMetadata: { billingCycleId: billing_cycle_id },
  });
  });
});

export const generateInvoiceForSelectionInput = withAuth(async (
  user,
  { tenant },
  selectorInput: IRecurringDueSelectionInput,
  options: { allowPoOverage?: boolean } = {},
  bridgeMetadata?: RecurringBridgeMetadata,
): Promise<InvoiceViewModel | null | InvoiceGenerationActionError> => {
  return withInvoiceGenerationActionErrors(async () => {
  if (!await hasPermission(user, 'invoice', 'create') && !await hasPermission(user, 'invoice', 'generate')) {
    throw new Error('Permission denied: invoice create or generate required');
  }

  const { knex } = await createTenantKnex();
  let normalizedSelectorInput = selectorInput;

  try {
    normalizedSelectorInput = await normalizeRecurringSelectorInput({
      knex,
      tenant,
      selectorInput,
    });
  } catch (error) {
    throw withRecurringWindowErrorContext(
      error instanceof Error
        ? error
        : new Error('An error occurred while validating the recurring execution window.'),
      selectorInput,
    );
  }

  return generateInvoiceForNormalizedSelectionInputs({
    user,
    tenant,
    knex,
    normalizedSelectorInputs: [normalizedSelectorInput],
    options,
    bridgeMetadata,
  });
  });
});

async function generateInvoiceForNormalizedSelectionInputs(params: {
  user: Session;
  tenant: string;
  knex: Knex;
  normalizedSelectorInputs: IRecurringDueSelectionInput[];
  options?: { allowPoOverage?: boolean };
  bridgeMetadata?: RecurringBridgeMetadata;
}): Promise<InvoiceViewModel | null> {
  const { user, tenant, knex } = params;
  const normalizedSelectorInput = assertSameRecurringSelectionWindow(params.normalizedSelectorInputs);
  const billing_cycle_id = resolveRecurringInvoiceBridgeId(params.bridgeMetadata);
  const client_id = normalizedSelectorInput.clientId;
  const cycleStart = normalizedSelectorInput.windowStart;
  const cycleEnd = normalizedSelectorInput.windowEnd;

  const clientForValidation = await tenantDb(knex, tenant).table('clients')
    .where({ client_id })
    .select('client_name')
    .first();
  if (clientForValidation) {
    const emailValidation = await validateClientBillingEmail(knex, tenant, client_id, clientForValidation.client_name);
    if (!emailValidation.valid) {
      throw withRecurringWindowErrorContext(new Error(emailValidation.error), normalizedSelectorInput);
    }
  }

  for (const selectorInput of params.normalizedSelectorInputs) {
    const existingInvoice = await findExistingRecurringInvoiceForSelectionInput({
      knex,
      tenant,
      selectorInput,
    });
    if (existingInvoice) {
      throw buildDuplicateRecurringInvoiceError({
        selectorInput,
        invoiceId: existingInvoice.invoiceId,
      });
    }
  }

  const approvalBlockerRows = await resolveApprovalBlockerRowsForSelectorInputs({
    knex,
    tenant,
    selectorInputs: params.normalizedSelectorInputs,
  });
  const approvalBlockedCountsByExecutionIdentityKey = await detectRecurringApprovalBlockers({
    knex,
    tenant,
    rows: approvalBlockerRows,
  });
  const approvalBlockedEntryCount = Array.from(approvalBlockedCountsByExecutionIdentityKey.values()).reduce(
    (sum, count) => sum + count,
    0,
  );
  if (approvalBlockedEntryCount > 0) {
    throw withRecurringWindowErrorContext(
      new Error(formatApprovalBlockedReason(approvalBlockedEntryCount)),
      normalizedSelectorInput,
    );
  }

  const billingEngine = new BillingEngine();
  const billingResult = await calculateBillingForSelectionInputs({
    billingEngine,
    selectorInputs: params.normalizedSelectorInputs,
  });
  if (billingResult.error) {
    throw withRecurringWindowErrorContext(new Error(billingResult.error), normalizedSelectorInput);
  }

  const clientContractId = getSingleClientContractIdFromCharges(billingResult.charges);
  if (clientContractId) {
    const poContext = await getClientContractPurchaseOrderContext({ knex, tenant, clientContractId });
    if (poContext.po_required && !poContext.po_number) {
      throw withRecurringWindowErrorContext(
        new Error(
          'Purchase Order is required for this contract but has not been provided. Please add a PO number to the contract before generating invoices.',
        ),
        normalizedSelectorInput,
      );
    }

    if (poContext.po_amount != null) {
      const defaultRegion = await getClientDefaultTaxRegionCode(knex, tenant, client_id);
      const previewTax = await calculatePreviewTax(
        billingResult.charges,
        client_id,
        cycleEnd,
        defaultRegion || '',
      );
      const invoiceTotal = Math.trunc(billingResult.totalAmount + previewTax);
      const consumed = await getPurchaseOrderConsumedCents({ knex, tenant, clientContractId });
      const computed = computePurchaseOrderOverage({
        authorizedCents: poContext.po_amount,
        consumedCents: consumed,
        invoiceTotalCents: invoiceTotal,
      });
      if (computed.overageCents > 0 && !params.options?.allowPoOverage) {
        const currencyCode = billingResult.currency_code || 'USD';
        console.warn(
          `[generateInvoice] PO overage detected (client_contract_id=${clientContractId}). ` +
            `Over by ${formatCurrencyFromMinorUnits(computed.overageCents, 'en-US', currencyCode)}; continuing because PO limits are advisory.`,
        );
      }
    }
  }

  const clientSettings = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return tenantDb(trx, tenant).table('client_billing_settings').where({ client_id }).first();
  });
  const defaultSettings = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return tenantDb(trx, tenant).table('default_billing_settings').first();
  });
  const settings = clientSettings || defaultSettings;
  if (!settings) {
    throw new Error('No billing settings found');
  }

  const zeroDollarInvoice = billingResult.finalAmount === 0;
  const zeroDollarHasPersistableContent = hasPersistedInvoiceContent(billingResult);
  if (zeroDollarInvoice) {
    if (settings.suppress_zero_dollar_invoices && !zeroDollarHasPersistableContent) {
      return null;
    }

    const createdInvoice = await createInvoiceFromBillingResult(
      billingResult,
      client_id,
      cycleStart,
      cycleEnd,
      billing_cycle_id,
      user.user_id,
    );
    if (settings.zero_dollar_invoice_handling === 'finalized') {
      await finalizeInvoiceWithKnex(createdInvoice.invoice_id, knex, tenant, user.user_id);
    }
    return Invoice.getFullInvoiceById(knex, tenant, createdInvoice.invoice_id);
  }

  if (billingResult.charges.length === 0) {
    throw withRecurringWindowErrorContext(new Error('Nothing to bill'), normalizedSelectorInput);
  }
  for (const charge of billingResult.charges) {
    if (charge.rate === undefined || charge.rate === null) {
      throw withRecurringWindowErrorContext(
        new Error(`Service "${charge.serviceName}" has an undefined rate`),
        normalizedSelectorInput,
      );
    }
  }

  const createdInvoice = await createInvoiceFromBillingResult(
    billingResult,
    client_id,
    cycleStart,
    cycleEnd,
    billing_cycle_id,
    user.user_id,
  );

  return Invoice.getFullInvoiceById(knex, tenant, createdInvoice.invoice_id);
}

export const generateInvoiceForSelectionInputs = withAuth(async (
  user,
  { tenant },
  selectorInputs: IRecurringDueSelectionInput[],
  options: { allowPoOverage?: boolean } = {},
  bridgeMetadata?: RecurringBridgeMetadata,
): Promise<InvoiceViewModel | null | InvoiceGenerationActionError> => {
  return withInvoiceGenerationActionErrors(async () => {
  if (!await hasPermission(user, 'invoice', 'create') && !await hasPermission(user, 'invoice', 'generate')) {
    throw new Error('Permission denied: invoice create or generate required');
  }

  const { knex } = await createTenantKnex();
  if (!Array.isArray(selectorInputs) || selectorInputs.length === 0) {
    throw new Error('No recurring execution windows selected');
  }

  let normalizedSelectorInputs: IRecurringDueSelectionInput[];
  try {
    normalizedSelectorInputs = await Promise.all(
      selectorInputs.map((selectorInput) =>
        normalizeRecurringSelectorInput({
          knex,
          tenant,
          selectorInput,
        }),
      ),
    );
  } catch (error) {
    throw withRecurringWindowErrorContext(
      error instanceof Error
        ? error
        : new Error('An error occurred while validating the recurring execution window.'),
      selectorInputs[0],
    );
  }

  return generateInvoiceForNormalizedSelectionInputs({
    user,
    tenant,
    knex,
    normalizedSelectorInputs,
    options,
    bridgeMetadata,
  });
  });
});

export const generateInvoiceNumber = withAuth(async (
  user,
  { tenant },
  _trx?: Knex.Transaction
): Promise<string> => {
  // Check permissions
  if (!await hasPermission(user, 'invoice', 'create') && !await hasPermission(user, 'invoice', 'generate')) {
    throw new Error('Permission denied: Cannot generate invoice numbers');
  }

  const { knex } = await createTenantKnex();
  return SharedNumberingService.getNextNumber('INVOICE', {
    knex: _trx ?? knex,
    tenant,
  });
});

export const generateInvoicePDF = withAuth(async (
  user,
  { tenant },
  invoiceId: string
): Promise<{ file_id: string } | InvoiceGenerationActionError> => {
  return withInvoiceGenerationActionErrors(async () => {
  const { knex } = await createTenantKnex();

  // Check permissions
  if (!await hasPermission(user, 'invoice', 'create') && !await hasPermission(user, 'invoice', 'generate')) {
    throw new Error('Permission denied: Cannot generate invoice PDFs');
  }

  // Use the factory function to create the PDF generation service
  const pdfGenerationService = createPDFGenerationService(tenant);

  const invoice = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await tenantDb(trx, tenant).table('invoices')
      .where({ invoice_id: invoiceId })
      .first(['invoice_number']);
  });

  if (!invoice?.invoice_number) {
    throw new Error('Invoice not found');
  }

  const fileRecord = await pdfGenerationService.generateAndStore({
    invoiceId,
    invoiceNumber: invoice.invoice_number,
    userId: user.user_id
  });

  return { file_id: fileRecord.file_id };
  });
});

export const downloadInvoicePDF = withAuth(async (
  user,
  { tenant },
  invoiceId: string,
  templateId?: string | null
): Promise<{ pdfData: number[]; invoiceNumber: string } | InvoiceGenerationActionError> => {
  return withInvoiceGenerationActionErrors(async () => {
  try {
    console.log('[downloadInvoicePDF] Called with invoiceId:', invoiceId, 'templateId:', templateId);

    const { knex } = await createTenantKnex();

    // Check permissions
    if (!await hasPermission(user, 'invoice', 'read')) {
      throw new Error('Permission denied: Cannot download invoice PDFs');
    }

    // Get invoice details
    const invoice = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table('invoices')
        .where({ invoice_id: invoiceId })
        .first();
    });

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    console.log('[downloadInvoicePDF] Generating PDF for invoice:', invoice.invoice_number);
    // Use the PDF generation service to generate the PDF
    const pdfGenerationService = createPDFGenerationService(tenant);

    const pdfBuffer = await pdfGenerationService.generatePDF({
      invoiceId,
      userId: user.user_id,
      templateId: templateId || undefined,
    });

    console.log('[downloadInvoicePDF] PDF generated, size:', pdfBuffer.length, 'bytes');
    // Convert Buffer to plain array for serialization across server/client boundary
    return {
      pdfData: Array.from(pdfBuffer),
      invoiceNumber: invoice.invoice_number
    };
  } catch (error) {
    console.error('[downloadInvoicePDF] Error:', error);
    console.error('[downloadInvoicePDF] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    throw error;
  }
  });
});

export const createInvoiceFromBillingResult = withAuth(async (
  user,
  { tenant },
  billingResult: IBillingResult,
  clientId: string,
  cycleStart: ISO8601String,
  cycleEnd: ISO8601String,
  billing_cycle_id: string | null,
  userId: string,
  options: { projectId?: string } = {},
): Promise<IInvoice> => {
  // Verify that the userId matches the current user
  if (user.user_id !== userId) {
    throw new Error('Permission denied: User ID mismatch');
  }

  const { knex } = await createTenantKnex();

  const client = await getClientDetails(knex, tenant, clientId);
  let region_code = await getClientDefaultTaxRegionCode(knex, tenant, clientId);
  const taxService = new TaxService();

  if (!region_code) {
    console.warn(`[createInvoiceFromBillingResult] Client ${clientId} (${client.client_name}) has no default tax region. Attempting to create default tax settings automatically.`);
    try {
      await taxService.ensureDefaultTaxSettings(clientId);
      region_code = await getClientDefaultTaxRegionCode(knex, tenant, clientId);
    } catch (autoConfigError) {
      console.error(`[createInvoiceFromBillingResult] Failed to auto-configure default tax region for client ${clientId}:`, autoConfigError);
    }
  }

  if (!region_code) {
    console.error(`[createInvoiceFromBillingResult] Cannot create invoice for client ${clientId} (${client.client_name}) because it lacks a default tax region (region_code) even after auto-configuration attempt.`);
    throw new Error(`Client '${client.client_name}' does not have a default tax region configured. Please set one before generating invoices.`);
  }
  const currentDate = Temporal.Now.plainDateISO().toString();
  const due_date = unwrapBillingHelperResult(await getDueDate(clientId, currentDate));
  // taxService initialized above
  // let subtotal = 0; // Subtotal will be calculated by persistInvoiceCharges

  // Determine tax source for this invoice based on client/tenant settings
  const taxSource = await getInitialInvoiceTaxSource(clientId);
  const useTaxDelegation = await shouldUseTaxDelegation(clientId);

  const clientContractId = getSingleClientContractIdFromCharges(billingResult.charges);
  const invoicePoNumber = clientContractId
    ? (await getClientContractPurchaseOrderContext({ knex, tenant, clientContractId })).po_number
    : null;

  // Create base invoice object
  const invoiceData = {
    client_id: clientId,
    ...(options.projectId ? { project_id: options.projectId } : {}),
    client_contract_id: clientContractId,
    po_number: invoicePoNumber,
    invoice_date: toISODate(Temporal.PlainDate.from(currentDate)),
    due_date,
    subtotal: 0,
    tax: 0,
    total_amount: 0,
    status: 'draft',
    invoice_number: '',
    credit_applied: 0,
    billing_cycle_id,
    tenant,
    currency_code: billingResult.currency_code || 'USD',
    is_manual: false,
    // `billing_period_start/end` stores the INVOICE WINDOW (when this cycle may be cut),
    // not the service period. Service periods live in `recurring_service_periods`.
    // Column rename to `invoice_window_*` is pending — do not treat these as customer-facing dates.
    billing_period_start: toPlainDate(cycleStart),
    billing_period_end: toPlainDate(cycleEnd),
    // Tax source: 'internal', 'pending_external', or 'external'
    tax_source: taxSource
  };

  let newInvoice: IInvoice | null = null;
  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      const invoiceNumber = await generateInvoiceNumber(); // Uses local function
      invoiceData.invoice_number = invoiceNumber;
      const [insertedInvoice] = await withTransaction(knex, async (trx: Knex.Transaction) => {
        // Check permissions within transaction
        if (!await hasPermission(user, 'invoice', 'create') && !await hasPermission(user, 'invoice', 'generate')) {
          throw new Error('Permission denied: Cannot create invoices');
        }

        return await tenantDb(trx, tenant).table('invoices').insert(invoiceData).returning('*');
      });
      newInvoice = insertedInvoice;
      break;
    } catch (error: unknown) {
      if (error instanceof Error &&
        'code' in error &&
        error.code === '23505' &&
        'constraint' in error &&
        error.constraint === 'unique_invoice_number_per_tenant') {
        retryCount++;
        if (retryCount >= maxRetries) {
          throw new Error('Unable to generate a unique invoice number after multiple attempts.');
        }
      } else {
        throw error;
      }
    }
  }

  if (!newInvoice) {
    throw new Error('Invoice creation completed without returning an invoice.');
  }

  let persistedCapDeltas: ProjectCapPersistenceDelta[] = [];
  await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Permission already checked in previous transaction, no need to recheck
    // Just use currentUser that we already validated

    // Persist all items (including fixed details) using the dedicated service function
    const sessionObject: Session = {
      user: {
        id: user.user_id,
        email: user.email,
        name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username,
        username: user.username,
        image: user.icon,
        proToken: '', // Not available in user, using empty string
        tenant: user.tenant,
        user_type: user.user_type,
        clientId: undefined, // Not available in user
        contactId: user.contact_id
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours from now
    };
    const capDeltas = await prepareProjectCapChargesForPersistence(
      trx,
      billingResult.charges,
    );
    persistedCapDeltas = capDeltas;
    const projectScheduleCharges = billingResult.charges.filter(isProjectScheduleCharge);
    const standardCharges = billingResult.charges.filter((charge) => !isProjectScheduleCharge(charge));
    const standardSubtotal = await persistInvoiceCharges(
      trx,
      newInvoice!.invoice_id,
      standardCharges,
      client,
      sessionObject,
      tenant
    );
    const projectScheduleSubtotal = await persistProjectScheduleCharges(
      trx,
      newInvoice!.invoice_id,
      projectScheduleCharges,
      client,
      tenant,
      userId,
    );
    const calculatedSubtotal = standardSubtotal + projectScheduleSubtotal;

    // Mark ticket/project materials in this billing window as billed by this invoice.
    // These materials were included by BillingEngine as non-contract charges (like usage/time).
    try {
      const billedAt = Temporal.Now.instant().toString();
      if (options.projectId) {
        await tenantDb(trx, tenant).table('project_materials')
          .where({
            client_id: client.client_id,
            project_id: options.projectId,
            is_billed: false,
          })
          .andWhere('currency_code', '=', billingResult.currency_code || 'USD')
          .update({
            is_billed: true,
            billed_invoice_id: newInvoice!.invoice_id,
            billed_at: billedAt,
            updated_at: billedAt
          });
      } else {
        await tenantDb(trx, tenant).table('ticket_materials')
          .where({ client_id: client.client_id, is_billed: false })
          .andWhere('currency_code', '=', billingResult.currency_code || 'USD')
          .andWhere('created_at', '>=', cycleStart)
          .andWhere('created_at', '<', cycleEnd)
          .update({
            is_billed: true,
            billed_invoice_id: newInvoice!.invoice_id,
            billed_at: billedAt,
            updated_at: billedAt
          });

        await tenantDb(trx, tenant).table('project_materials')
          .where({ client_id: client.client_id, is_billed: false })
          .andWhere('currency_code', '=', billingResult.currency_code || 'USD')
          .andWhere('created_at', '>=', cycleStart)
          .andWhere('created_at', '<', cycleEnd)
          .update({
            is_billed: true,
            billed_invoice_id: newInvoice!.invoice_id,
            billed_at: billedAt,
            updated_at: billedAt
          });
      }
    } catch (err) {
      if (!isMissingRelationError(err)) {
        throw err;
      }
    }

    // Process discounts (if any) - This might need adjustment if persistInvoiceCharges handles them
    // For now, assume discounts are separate and need processing here.
    let discountSubtotalAdjustment = 0;
    for (const discount of billingResult.discounts) {
      const netAmount = Math.round(-(discount.amount || 0));
      const discountItem = {
        item_id: uuidv4(),
        invoice_id: newInvoice!.invoice_id,
        description: discount.discount_name,
        quantity: 1,
        unit_price: netAmount,
        net_amount: netAmount,
        tax_amount: 0,
        tax_rate: 0,
        total_price: netAmount,
        is_taxable: false,
        is_discount: true,
        is_manual: false,
        tenant,
        created_by: userId
      };
      await tenantDb(trx, tenant).table('invoice_charges').insert(discountItem);
      discountSubtotalAdjustment += netAmount; // Add negative amount
    }

    // Use the subtotal returned by persistInvoiceCharges + discount adjustment
    const subtotal = calculatedSubtotal + discountSubtotalAdjustment;

    // Leverage the shared tax helper so automated invoices mirror manual invoices
    const calculatedTax = await calculateAndDistributeTax(
      trx,
      newInvoice!.invoice_id,
      client,
      taxService,
      tenant
    );

    const finalSubtotal = Math.ceil(subtotal);
    const finalTax = Math.ceil(calculatedTax);
    const totalAmount = finalSubtotal + finalTax;
    const availableCredit = await ClientContractLine.getClientCredit(clientId);
    const creditToApply = Math.min(availableCredit, Math.ceil(totalAmount));

    // Update the invoice with subtotal, tax, and total amount
    await tenantDb(trx, tenant).table('invoices')
      .where({ invoice_id: newInvoice!.invoice_id })
      .update({
        subtotal: finalSubtotal,
        tax: finalTax,
        total_amount: Math.ceil(totalAmount),
        credit_applied: 0
      });

    // Corrected call signature: removed finalSubtotal and finalTax as they are recalculated internally
    await updateInvoiceTotalsAndRecordTransaction(
      trx,
      newInvoice!.invoice_id,
      client,
      tenant,
      invoiceData.invoice_number
      // expirationDate is optional and not needed here
    );

    if (capDeltas.length > 0) {
      const invoiceTransaction = await tenantDb(trx, tenant).table('transactions')
        .where({
          invoice_id: newInvoice!.invoice_id,
          type: 'invoice_generated',
        })
        .orderBy('created_at', 'desc')
        .first('transaction_id', 'metadata');
      if (!invoiceTransaction) {
        throw new Error(`Invoice transaction for ${newInvoice!.invoice_id} was not found`);
      }
      const existingMetadata = invoiceTransaction.metadata
        && typeof invoiceTransaction.metadata === 'object'
        ? invoiceTransaction.metadata
        : {};
      await tenantDb(trx, tenant).table('transactions')
        .where({ transaction_id: invoiceTransaction.transaction_id })
        .update({
          metadata: {
            ...existingMetadata,
            project_billing_cap_deltas: capDeltas,
            project_billing_cap_rolled_back: false,
          },
        });
    }
  });

  for (const delta of persistedCapDeltas) {
    for (const threshold of delta.notifiedThresholds) {
      await publishEvent({
        eventType: 'PROJECT_BUDGET_THRESHOLD_REACHED',
        payload: {
          tenantId: tenant,
          projectId: delta.projectId,
          threshold,
          billed: delta.billedAfter,
          cap: delta.cap,
        },
      });
    }
  }

  // Track analytics
  const { analytics, AnalyticsEvents } = await getAnalyticsAsync();
  analytics.capture(AnalyticsEvents.INVOICE_GENERATED, {
    invoice_id: newInvoice.invoice_id,
    invoice_number: newInvoice.invoice_number,
    client_id: clientId,
    subtotal: newInvoice.subtotal,
    tax: newInvoice.tax,
    total_amount: newInvoice.total_amount,
    billing_period_start: cycleStart,
    billing_period_end: cycleEnd,
    charge_count: billingResult.charges.length,
    discount_count: billingResult.discounts.length,
    is_manual: false
  }, userId);

  return newInvoice;
});
