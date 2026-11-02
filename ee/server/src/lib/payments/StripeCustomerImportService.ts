import { createHash } from 'node:crypto';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { getConnection, tenantDb } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';
import { resolveInvoiceBillingRecipient } from '@alga-psa/billing/services/invoiceBillingRecipientService';
import { createStripePaymentProvider } from './StripePaymentProvider';
import {
  classifyImport,
  importMetadata,
  proposeCustomerMatches,
  type AlgaState,
  type ImportInputRow,
  type ImportPlan,
  type MatchCandidate,
  type RowPlan,
  type StripeCustomerSnapshot,
} from './stripeImportClassifier';

/** The slice of the Stripe provider the import needs; injectable for tests. */
export interface StripeImportGateway {
  getCustomerImportSnapshot(customerId: string): Promise<StripeCustomerSnapshot | null>;
  listCustomersForImport(): Promise<{ customers: StripeCustomerSnapshot[]; truncated: boolean }>;
  updateCustomerMetadata(customerId: string, metadata: Record<string, string>, idempotencyKey: string): Promise<Record<string, string>>;
  updateSavedPaymentMethodMetadata(externalId: string, metadata: Record<string, string>): Promise<Record<string, string>>;
  capabilities(): { supportedCurrencies: string[] };
}

/** Stripe's default limit is ~100 req/s live; each snapshot is 4 calls, so keep the fan-out small. */
export const SNAPSHOT_CONCURRENCY = 5;

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. First rejection rejects. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export type ImportRowStatus = 'imported' | 'unchanged' | 'skipped' | 'conflict' | 'failed';
export type ImportEnrollmentStatus = 'enrolled' | 'not-requested' | 'not-eligible' | 'already-enrolled' | 'failed';

export interface ImportRowResult {
  rowId: string;
  status: ImportRowStatus;
  reason?: string;
  cardsImported: number;
  enrollment: ImportEnrollmentStatus;
  error?: string;
}

/** Enrolls via the existing setClientAutopay path; supplied by the (authenticated) server action. */
export type EnrollCallback = (row: RowPlan, paymentMethodId: string) => Promise<void>;

/** Stable digest of a plan, so execute can prove it is applying what the operator previewed. */
export function computePlanDigest(plan: ImportPlan): string {
  return createHash('sha256').update(JSON.stringify(plan.rows)).digest('hex');
}

/** Throws unless every expected key/value is present in what Stripe says it stored. */
function assertStamped(what: string, id: string, expected: Record<string, string>, returned: Record<string, string> | null | undefined): void {
  const missing = Object.entries(expected).filter(([key, value]) => returned?.[key] !== value).map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`Stripe did not persist the import metadata on ${what} ${id} (missing or mismatched: ${missing.join(', ')}); nothing was imported for this row`);
  }
}

/**
 * Idempotency key for the customer stamp. Stripe replays the cached response for a reused key for ~24h, so the key must
 * differ per import attempt (attemptId) yet stay stable for retries inside one attempt. Always well under Stripe's 255 chars.
 */
export function customerStampIdempotencyKey(tenantId: string, row: Pick<RowPlan, 'customerId' | 'clientId' | 'billingProfileId'>, attemptId: string, stamp: Record<string, string>): string {
  const stampHash = createHash('sha256').update(JSON.stringify(Object.entries(stamp).sort())).digest('hex').slice(0, 16);
  return `alga_import:${tenantId}:${row.customerId}:${row.clientId}:${row.billingProfileId}:${attemptId}:${stampHash}`;
}

export class StripeCustomerImportService {
  constructor(
    private readonly tenantId: string,
    private readonly knex: Knex,
    private readonly gateway: StripeImportGateway,
    private readonly now: () => Date = () => new Date(),
  ) {}

  static async create(tenantId: string): Promise<StripeCustomerImportService> {
    return new StripeCustomerImportService(tenantId, await getConnection(), createStripePaymentProvider(tenantId) as unknown as StripeImportGateway);
  }

  private table(name: string, knex: Knex | Knex.Transaction = this.knex) {
    return tenantDb(knex, this.tenantId).table(name);
  }

  async loadAlgaState(): Promise<AlgaState> {
    const [profiles, mappings, methods, enrollments] = await Promise.all([
      this.table('client_billing_profiles as p')
        .join('clients as c', function () { this.on('c.tenant', '=', 'p.tenant').andOn('c.client_id', '=', 'p.client_id'); })
        .select('p.client_id', 'p.billing_profile_id', 'p.name as profile_name', 'p.is_active', 'c.client_name', 'c.default_currency_code'),
      this.table('client_payment_customers').where({ provider_type: 'stripe' }).select('client_id', 'billing_profile_id', 'external_customer_id'),
      this.table('payment_methods').where({ provider_type: 'stripe' })
        .select('payment_method_id', 'external_payment_method_id', 'client_id', 'billing_profile_id', 'is_default', 'is_deleted', 'status'),
      this.table('billing_profile_autopay').where({ is_enabled: true }).select('billing_profile_id'),
    ]);
    return {
      tenantId: this.tenantId,
      // Same currency chain as SavedPaymentMethodService.startSetup, minus columns billing profiles do not have.
      profiles: profiles.map((p: any) => ({
        clientId: p.client_id, billingProfileId: p.billing_profile_id, clientName: p.client_name, profileName: p.profile_name,
        isActive: p.is_active !== false,
        currency: String(p.default_currency_code ?? process.env.DEFAULT_CURRENCY ?? '').toLowerCase() || null,
      })),
      mappings: mappings.map((m: any) => ({ clientId: m.client_id, billingProfileId: m.billing_profile_id, customerId: m.external_customer_id })),
      paymentMethods: methods.filter((m: any) => m.external_payment_method_id).map((m: any) => ({
        paymentMethodId: m.payment_method_id, externalPaymentMethodId: m.external_payment_method_id, clientId: m.client_id,
        billingProfileId: m.billing_profile_id, isDefault: !!m.is_default, isDeleted: !!m.is_deleted, status: m.status,
      })),
      enrolledProfileIds: enrollments.map((e: any) => e.billing_profile_id),
      supportedCurrencies: this.gateway.capabilities().supportedCurrencies.map((code) => code.toUpperCase()),
      now: this.now(),
    };
  }

  /** Phase 1: fetch state and classify. Writes nothing. The preview is exactly this return value. */
  async preview(rows: ImportInputRow[]): Promise<ImportPlan> {
    const alga = await this.loadAlgaState();
    const ids = [...new Set(rows.map((row) => row.customerId).filter((id) => /^cus_[A-Za-z0-9]+$/.test(id)))];
    const snapshots = await mapWithConcurrency(ids, SNAPSHOT_CONCURRENCY, (id) => this.gateway.getCustomerImportSnapshot(id));
    return classifyImport({ rows, customers: snapshots.filter((s): s is StripeCustomerSnapshot => !!s), alga });
  }

  /** Assisted matching: proposals only. Nothing is written; the operator reviews, then it goes through preview(). */
  async proposeMatches() {
    const [alga, listing] = await Promise.all([this.loadAlgaState(), this.gateway.listCustomersForImport()]);
    const activeCounts = new Map<string, number>();
    for (const p of alga.profiles) if (p.isActive) activeCounts.set(p.clientId, (activeCounts.get(p.clientId) ?? 0) + 1);
    const mapped = new Set(alga.mappings.map((m) => m.billingProfileId));
    const candidates: MatchCandidate[] = [];
    for (const profile of alga.profiles.filter((p) => p.isActive)) {
      const recipient = await resolveInvoiceBillingRecipient({ knexOrTrx: this.knex, tenantId: this.tenantId, clientId: profile.clientId, billingProfileId: profile.billingProfileId });
      candidates.push({ clientId: profile.clientId, billingProfileId: profile.billingProfileId, clientName: profile.clientName, profileName: profile.profileName,
        email: recipient.recipientEmail || null, mapped: mapped.has(profile.billingProfileId), clientActiveProfileCount: activeCounts.get(profile.clientId) ?? 1 });
    }
    const result = proposeCustomerMatches({ customers: listing.customers, candidates, excludedCustomerIds: alga.mappings.map((m) => m.customerId) });
    const labels: Record<string, { clientName: string; profileName: string }> = {};
    for (const p of alga.profiles) labels[p.billingProfileId] = { clientName: p.clientName, profileName: p.profileName };
    return { ...result, truncated: listing.truncated, labels };
  }

  /**
   * Phase 2: apply exactly `plan`. Rows are independent; one failure never aborts the rest.
   * Enrollment happens only for rows in `attestedRowIds` whose plan says `enrollable`.
   */
  async execute(plan: ImportPlan, options: { attestedRowIds?: string[]; enroll?: EnrollCallback } = {}): Promise<ImportRowResult[]> {
    const attested = new Set(options.attestedRowIds ?? []);
    const results: ImportRowResult[] = [];
    const attemptId = uuidv4();
    for (const row of plan.rows) {
      const result: ImportRowResult = { rowId: row.rowId, status: 'unchanged', cardsImported: 0, enrollment: 'not-requested' };
      results.push(result);
      try {
        if (row.action === 'skip' || row.action === 'conflict') {
          result.status = row.action === 'skip' ? 'skipped' : 'conflict';
          result.reason = row.reason;
          if (attested.has(row.rowId)) result.enrollment = 'not-eligible';
          continue;
        }
        if (row.action === 'adopt') {
          result.cardsImported = await this.applyRow(row, attemptId);
          result.status = 'imported';
        }
        if (attested.has(row.rowId)) {
          // An enrollment failure must not mask a successful import.
          try {
            result.enrollment = await this.enrollRow(row, options.enroll);
          } catch (error) {
            logger.error('[StripeCustomerImport] Enrollment failed', { tenantId: this.tenantId, rowId: row.rowId, error });
            result.enrollment = 'failed';
            result.error = error instanceof Error ? error.message : String(error);
          }
        }
      } catch (error) {
        logger.error('[StripeCustomerImport] Row failed', { tenantId: this.tenantId, rowId: row.rowId, error });
        result.status = 'failed';
        result.error = error instanceof Error ? error.message : String(error);
      }
    }
    return results;
  }

  private async applyRow(row: RowPlan, attemptId: string): Promise<number> {
    const stamp = importMetadata(this.tenantId, row.clientId, row.billingProfileId);

    // Adoption order is mandatory (1): stamp the Stripe customer BEFORE any local mapping exists.
    // getOrCreateCustomer only reuses a cus_ whose metadata matches exactly; otherwise it overwrites
    // the mapping and orphans the customer.
    if (row.needsCustomerStamp) {
      const stored = await this.gateway.updateCustomerMetadata(row.customerId, stamp, customerStampIdempotencyKey(this.tenantId, row, attemptId, stamp));
      // A replayed or no-op update must never be reported as imported: verify the stamp really landed.
      assertStamped('customer', row.customerId, stamp, stored);
    }
    const cards = row.cards.filter((card) => card.action === 'import' || (card.action === 'already-imported' && card.needsMetadataStamp));
    for (const card of cards) {
      const cardStamp = { ...stamp };
      const storedCard = await this.gateway.updateSavedPaymentMethodMetadata(card.externalPaymentMethodId, cardStamp);
      assertStamped('payment method', card.externalPaymentMethodId, cardStamp, storedCard);
    }

    // Adoption order (2): local writes, one transaction per row.
    let imported = 0;
    await this.knex.transaction(async (trx) => {
      await this.table('client_billing_profiles', trx).where({ client_id: row.clientId, billing_profile_id: row.billingProfileId }).forUpdate().first();
      if (row.needsMapping) {
        await this.table('client_payment_customers', trx).insert({
          tenant: this.tenantId, client_id: row.clientId, billing_profile_id: row.billingProfileId, provider_type: 'stripe',
          external_customer_id: row.customerId, email: row.customerEmail, metadata: { name: row.customerName, source: 'alga_import' },
          updated_at: trx.fn.now(),
        } as any).onConflict(['tenant', 'client_id', 'billing_profile_id', 'provider_type'])
          .merge(['external_customer_id', 'email', 'metadata', 'updated_at']);
      }
      for (const card of row.cards.filter((c) => c.action === 'import')) {
        // Row shape mirrors SavedPaymentMethodService.completeSetup exactly (exp_* as strings, status 'active').
        // The conflict target is a PARTIAL unique index, so the predicate must be repeated for Postgres to infer it.
        // New rows are never default here: the unique default-per-profile index forces a second pass below.
        await trx.raw(
          `INSERT INTO payment_methods (tenant, payment_method_id, client_id, billing_profile_id, type, last4, exp_month, exp_year,
             is_default, is_deleted, provider_type, external_payment_method_id, external_customer_id, brand, fingerprint, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'credit_card', ?, ?, ?, false, false, 'stripe', ?, ?, ?, ?, 'active', now(), now())
           ON CONFLICT (tenant, provider_type, external_payment_method_id) WHERE external_payment_method_id IS NOT NULL
           DO UPDATE SET client_id = EXCLUDED.client_id, billing_profile_id = EXCLUDED.billing_profile_id, type = EXCLUDED.type,
             last4 = EXCLUDED.last4, exp_month = EXCLUDED.exp_month, exp_year = EXCLUDED.exp_year, brand = EXCLUDED.brand,
             fingerprint = EXCLUDED.fingerprint, external_customer_id = EXCLUDED.external_customer_id,
             is_deleted = false, is_default = false, status = 'active', updated_at = now()`,
          [this.tenantId, uuidv4(), row.clientId, row.billingProfileId, card.last4, card.expMonth, card.expYear,
            card.externalPaymentMethodId, row.customerId, card.brand, card.fingerprint],
        );
        imported += 1;
      }
      // Second pass: exactly one default per profile. Only set when the profile still has none.
      const defaultCard = row.cards.find((card) => card.setAsDefault);
      if (defaultCard) {
        const hasDefault = await this.table('payment_methods', trx)
          .where({ client_id: row.clientId, billing_profile_id: row.billingProfileId, is_default: true, is_deleted: false }).first();
        if (!hasDefault) {
          await this.table('payment_methods', trx)
            .where({ provider_type: 'stripe', external_payment_method_id: defaultCard.externalPaymentMethodId, is_deleted: false })
            .update({ is_default: true, updated_at: trx.fn.now() });
        }
      }
    });
    return imported;
  }

  private async enrollRow(row: RowPlan, enroll?: EnrollCallback): Promise<ImportEnrollmentStatus> {
    if (row.alreadyEnrolled) return 'already-enrolled';
    if (!row.enrollable || !row.enrollmentExternalPaymentMethodId || (row.action !== 'adopt' && row.action !== 'already-imported')) return 'not-eligible';
    if (!enroll) throw new Error('Enrollment requested but no enrollment handler was provided');
    const method = await this.table('payment_methods')
      .where({ provider_type: 'stripe', external_payment_method_id: row.enrollmentExternalPaymentMethodId, billing_profile_id: row.billingProfileId, is_deleted: false }).first();
    if (!method || method.status !== 'active') return 'not-eligible';
    await enroll(row, String(method.payment_method_id));
    return 'enrolled';
  }
}
