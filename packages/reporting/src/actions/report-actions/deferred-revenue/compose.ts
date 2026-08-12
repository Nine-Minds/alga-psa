/**
 * Composition of the deferred-revenue report: merge the credits and hours
 * rollforwards per client×currency, add tenant-level totals per currency, and
 * attach per-client detail rows. Pure over the loaded ledger rows, so the
 * server action is a thin auth+permission wrapper around it.
 */

import type { Knex } from 'knex';

import { computeCreditRollforward } from './credits';
import { computeHoursRollforward } from './hours';
import { monthKeyOf, monthRange } from './month';
import {
  buildBucketPeriodInputs,
  buildCreditDetailRows,
  loadDeferredRevenueData,
  type BuildDeferredRevenueInput,
  type LoadedClient,
} from './loaders';
import {
  addMovement,
  emptyMovement,
  type ClientRollforward,
  type CreditDetailRow,
  type CurrencySection,
  type DeferredRevenueReport,
  type MovementColumns,
} from './types';

export interface ComposableInputs extends BuildDeferredRevenueInput {
  clients: LoadedClient[];
}

function keyOf(clientId: string, currencyCode: string): string {
  return `${clientId}\u0000${currencyCode}`;
}

function parseKey(key: string): { clientId: string; currencyCode: string } {
  const separator = key.indexOf('\u0000');
  return {
    clientId: key.slice(0, separator),
    currencyCode: key.slice(separator + 1),
  };
}

function isNonZero(movement: MovementColumns): boolean {
  return (
    movement.opening !== 0 ||
    movement.issued !== 0 ||
    movement.applied !== 0 ||
    movement.expired !== 0 ||
    movement.adjustments !== 0 ||
    movement.closing !== 0
  );
}

/**
 * Credit detail retention rule (fix round 3). A credit row stays on the report
 * when it still carries liability as of the selected month's end (reconstructed
 * from the ledger, not from today's tracking state) or it moved during the
 * month. Rows that fail both carry nothing and explain nothing for the month —
 * keeping them would break the detail-to-closing reconciliation.
 */
function isRetainedCreditDetail(detail: CreditDetailRow): boolean {
  return detail.remainingAmount > 0 || detail.inMonthMovement !== 0;
}

function creditDetailsByClientCurrency(
  details: CreditDetailRow[],
): Map<string, CreditDetailRow[]> {
  const byKey = new Map<string, CreditDetailRow[]>();
  for (const detail of details) {
    const key = keyOf(detail.clientId, detail.currencyCode);
    const bucket = byKey.get(key) ?? [];
    bucket.push(detail);
    byKey.set(key, bucket);
  }
  return byKey;
}

/**
 * Build the full report for one calendar month from the live ledgers.
 *
 * @param month 'YYYY-MM'
 */
export function buildDeferredRevenueReportFromData(
  data: ComposableInputs,
  month: string,
): DeferredRevenueReport {
  const clientNameById = new Map(data.clients.map((client) => [client.clientId, client.clientName]));

  const creditRollforward = computeCreditRollforward(month, data.creditTransactions);
  const hoursRollforward = computeHoursRollforward(month, buildBucketPeriodInputs(data));
  const creditDetailRows = buildCreditDetailRows(
    data.creditTracking,
    data.creditTransactions,
    data.creditInvoices,
    month,
  );
  const creditDetailsByKey = creditDetailsByClientCurrency(
    creditDetailRows.filter(isRetainedCreditDetail),
  );

  const clientRows = new Map<string, ClientRollforward>();

  for (const [key, rollforward] of creditRollforward) {
    const { clientId, currencyCode } = parseKey(key);
    clientRows.set(key, {
      clientId,
      clientName: clientNameById.get(clientId) ?? 'Unknown client',
      currencyCode,
      credits: {
        opening: rollforward.opening,
        issued: rollforward.movement.issued,
        applied: rollforward.movement.applied,
        expired: rollforward.movement.expired,
        adjustments: rollforward.movement.adjustments,
        closing: rollforward.closing,
      },
      hours: emptyMovement(),
      total: emptyMovement(),
      creditDetails: [],
      bucketDetails: [],
    });
  }

  for (const [key, rollforward] of hoursRollforward) {
    const { clientId, currencyCode } = parseKey(key);
    const existing = clientRows.get(key);
    const hoursMovement: MovementColumns = {
      opening: rollforward.opening,
      issued: rollforward.issued,
      applied: rollforward.applied,
      expired: rollforward.expired,
      adjustments: 0,
      closing: rollforward.closing,
    };
    if (existing) {
      existing.hours = hoursMovement;
      existing.bucketDetails = rollforward.details;
    } else {
      clientRows.set(key, {
        clientId,
        clientName: clientNameById.get(clientId) ?? 'Unknown client',
        currencyCode,
        credits: emptyMovement(),
        hours: hoursMovement,
        total: emptyMovement(),
        creditDetails: [],
        bucketDetails: rollforward.details,
      });
    }
  }

  // Outstanding credit balances (still-remaining or in-month-movement detail
  // rows) must surface even when the month's movement is nil.
  for (const [key, details] of creditDetailsByKey) {
    const hasOutstanding = details.some(isRetainedCreditDetail);
    if (hasOutstanding) {
      const existing = clientRows.get(key);
      if (existing) {
        existing.creditDetails = details;
      } else {
        const { clientId, currencyCode } = parseKey(key);
        clientRows.set(key, {
          clientId,
          clientName: clientNameById.get(clientId) ?? 'Unknown client',
          currencyCode,
          credits: emptyMovement(),
          hours: emptyMovement(),
          total: emptyMovement(),
          creditDetails: details,
          bucketDetails: [],
        });
      }
    }
  }

  for (const [key, row] of clientRows) {
    row.total = addMovement(row.credits, row.hours);
    if (!creditDetailsByKey.has(key)) {
      row.creditDetails = [];
    }
    if (!row.bucketDetails) {
      row.bucketDetails = [];
    }
  }

  const byCurrency = new Map<string, ClientRollforward[]>();
  for (const row of clientRows.values()) {
    // A zero-balance client is omitted unless it has detail that proves a
    // balance: retained credit detail (reconstructed remaining > 0 or in-month
    // movement) or contributing bucket periods. Detail rows for fully-consumed
    // credits or future-month credits never retain a client on their own.
    const hasOutstandingCreditDetail = row.creditDetails.some(isRetainedCreditDetail);
    if (!isNonZero(row.total) && row.bucketDetails.length === 0 && !hasOutstandingCreditDetail) {
      continue;
    }
    const currencyRows = byCurrency.get(row.currencyCode) ?? [];
    currencyRows.push(row);
    byCurrency.set(row.currencyCode, currencyRows);
  }

  const sections: CurrencySection[] = [];
  for (const [currencyCode, rows] of byCurrency) {
    rows.sort((left, right) => left.clientName.localeCompare(right.clientName));
    const totals = { credits: emptyMovement(), hours: emptyMovement(), total: emptyMovement() };
    for (const row of rows) {
      totals.credits = addMovement(totals.credits, row.credits);
      totals.hours = addMovement(totals.hours, row.hours);
      totals.total = addMovement(totals.total, row.total);
    }
    sections.push({ currencyCode, totals, clients: rows });
  }
  sections.sort((left, right) => left.currencyCode.localeCompare(right.currencyCode));

  const hasSpanningPeriods = data.bucketPeriods.some(
    (period) => monthKeyOf(period.periodStart) !== monthKeyOf(period.periodEnd),
  );

  const notes: string[] = [];
  if (hasSpanningPeriods) {
    notes.push(
      'Bucket periods spanning calendar-month boundaries attribute their burn to the month the period ends in.',
    );
  }

  if (creditDetailRows.some((detail) => detail.reconstructionLimited)) {
    notes.push(
      'Credit balances affected by ledger activity that cannot be attributed to a specific credit (missing credit linkage) are reported at their current remaining balance.',
    );
  }

  return {
    month,
    generatedAt: new Date().toISOString(),
    sections,
    notes,
  };
}

export async function buildDeferredRevenueReport(
  conn: Knex | Knex.Transaction,
  tenant: string,
  month: string,
): Promise<DeferredRevenueReport> {
  monthRange(month); // validate before touching the database
  const data = await loadDeferredRevenueData(conn, tenant);
  return buildDeferredRevenueReportFromData(data, month);
}
