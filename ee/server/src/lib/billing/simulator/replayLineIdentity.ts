import type { SimulatedInvoiceLine } from '@alga-psa/types';

/**
 * The one identity "Compare with past invoices" pairs on, for issued and
 * simulated lines alike: origin contract line + charge stream/type + service.
 *
 * - The origin line comes from real attribution (the saved contract line each
 *   side resolves to), never from description text. Lines with no origin fall
 *   back to their own line_key.
 * - A fixed fee is recorded per line on the issued side (invoice_charges has no
 *   service_id) but per service on the simulated side, so the service is not
 *   part of a fixed fee's identity.
 */
export function replayLineIdentity(
  line: Pick<
    SimulatedInvoiceLine,
    'line_key' | 'origin_contract_line_id' | 'charge_type' | 'service_id'
  >,
): string {
  const origin = line.origin_contract_line_id ?? line.line_key;
  const service = line.charge_type === 'fixed' ? 'fixed' : (line.service_id ?? 'none');
  return `${origin}:${line.charge_type}:${service}`;
}

export interface ReplayLinePairing {
  key: string;
  service_name: string;
  actual: number;
  simulated: number;
  delta: number;
}

/** Pairs issued and simulated lines by replayLineIdentity, summing duplicates. */
export function pairReplayLines(
  actualLines: SimulatedInvoiceLine[],
  simulatedLines: SimulatedInvoiceLine[],
): ReplayLinePairing[] {
  const rows = new Map<string, ReplayLinePairing>();
  const add = (line: SimulatedInvoiceLine, side: 'actual' | 'simulated') => {
    const key = replayLineIdentity(line);
    const row =
      rows.get(key) ??
      { key, service_name: line.service_name, actual: 0, simulated: 0, delta: 0 };
    if (side === 'simulated') row.service_name = line.service_name;
    row[side] += line.total;
    row.delta = row.simulated - row.actual;
    rows.set(key, row);
  };
  for (const line of actualLines) add(line, 'actual');
  for (const line of simulatedLines) add(line, 'simulated');
  return Array.from(rows.values());
}
