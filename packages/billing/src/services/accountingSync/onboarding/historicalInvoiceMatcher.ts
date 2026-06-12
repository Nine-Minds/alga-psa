/**
 * Historical invoice matching service for the QBO onboarding wizard.
 *
 * Designed for testability: the QBO page-fetcher and Alga invoice-fetcher are
 * injected so tests can replace them with stubs.
 */

import logger from '@alga-psa/core/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QboInvoiceRow {
  Id: string;
  DocNumber?: string;
  TotalAmt?: number | string;
  SyncToken?: string;
  CustomerRef?: { value: string; name?: string };
}

export interface AlgaInvoiceRow {
  invoice_id: string;
  invoice_number: string;
  /** total_amount stored as integer cents in Alga */
  total_amount: number;
  client_id: string | null;
}

export interface HistMatch {
  invoiceId: string;
  invoiceNumber: string;
  invoiceTotal: number;
  externalId: string;
  externalDocNumber: string;
  externalTotal: number;
  externalSyncToken?: string;
  clientId: string | null;
}

export interface HistoricalMatchResult {
  confident: HistMatch[];
  review: Array<HistMatch & { reason: string }>;
}

// ─── Injected fetchers ────────────────────────────────────────────────────────

export type QboInvoiceFetcher = (options?: { windowStart?: string }) => Promise<QboInvoiceRow[]>;
export type AlgaInvoiceFetcher = (options?: { windowStart?: string }) => Promise<AlgaInvoiceRow[]>;

// ─── Core matching logic ──────────────────────────────────────────────────────

const CENT_TOLERANCE = 1; // 1 cent

function toCents(value: number | string | undefined | null): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * Match Alga finalized (unmapped) invoices against QBO invoices.
 *
 * Confident: DocNumber === invoice_number AND |total difference| <= 1 cent
 *   AND (customer unmapped OR customer mapping matches CustomerRef.value)
 *
 * Review: DocNumber collision (multiple QBO rows with same DocNumber) or
 *   total mismatch when doc number matches.
 */
export function matchHistoricalInvoices(
  algaInvoices: AlgaInvoiceRow[],
  qboInvoices: QboInvoiceRow[],
  /** externalId → algaClientId for any already-mapped client */
  clientMappings: Map<string, string>
): HistoricalMatchResult {
  // Index QBO invoices by DocNumber (may collide)
  const qboByDocNumber = new Map<string, QboInvoiceRow[]>();
  for (const qi of qboInvoices) {
    const doc = qi.DocNumber?.trim() ?? '';
    if (!doc) continue;
    const arr = qboByDocNumber.get(doc) ?? [];
    arr.push(qi);
    qboByDocNumber.set(doc, arr);
  }

  const confident: HistMatch[] = [];
  const review: Array<HistMatch & { reason: string }> = [];

  for (const ai of algaInvoices) {
    const invoiceNumber = ai.invoice_number?.trim() ?? '';
    if (!invoiceNumber) continue;

    const candidates = qboByDocNumber.get(invoiceNumber);
    if (!candidates || candidates.length === 0) continue;

    if (candidates.length > 1) {
      // Collision: doc number maps to multiple QBO invoices → all go to review
      for (const qi of candidates) {
        const externalTotal = toCents(qi.TotalAmt);
        review.push({
          invoiceId: ai.invoice_id,
          invoiceNumber: ai.invoice_number,
          invoiceTotal: ai.total_amount,
          externalId: qi.Id,
          externalDocNumber: qi.DocNumber ?? '',
          externalTotal,
          externalSyncToken: qi.SyncToken,
          clientId: ai.client_id,
          reason: 'doc_number_collision'
        });
      }
      continue;
    }

    const qi = candidates[0];
    const externalTotal = toCents(qi.TotalAmt);
    const algaTotal = ai.total_amount; // already in cents

    const totalDiff = Math.abs(externalTotal - algaTotal);

    const base: HistMatch = {
      invoiceId: ai.invoice_id,
      invoiceNumber: ai.invoice_number,
      invoiceTotal: algaTotal,
      externalId: qi.Id,
      externalDocNumber: qi.DocNumber ?? '',
      externalTotal,
      externalSyncToken: qi.SyncToken,
      clientId: ai.client_id
    };

    if (totalDiff > CENT_TOLERANCE) {
      review.push({ ...base, reason: 'total_mismatch' });
      continue;
    }

    // Customer check: if the QBO invoice has a CustomerRef, check it's
    // consistent with any existing client mapping.
    const qboCustomerId = qi.CustomerRef?.value ?? null;
    if (qboCustomerId && ai.client_id) {
      const mappedClientId = clientMappings.get(qboCustomerId);
      if (mappedClientId && mappedClientId !== ai.client_id) {
        review.push({ ...base, reason: 'customer_mismatch' });
        continue;
      }
    }

    confident.push(base);
  }

  return { confident, review };
}

/**
 * Full paged-query runner for QBO invoices.
 * Called from the onboarding action; injected in tests.
 */
export async function fetchAllQboInvoices(
  qboFetcher: QboInvoiceFetcher,
  options?: { windowStart?: string }
): Promise<QboInvoiceRow[]> {
  try {
    return await qboFetcher(options);
  } catch (error) {
    logger.warn('[historicalInvoiceMatcher] Failed to fetch QBO invoices', { error });
    throw error;
  }
}
