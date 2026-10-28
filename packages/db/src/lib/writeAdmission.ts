/**
 * Write-admission primitive.
 *
 * A domain that must veto or condition a native write (for example a read-only
 * workspace) registers ONE provider here. Native write paths call `admitWrite`
 * inside the transaction that performs the write, before row access.
 *
 * With no provider registered, `admitWrite` returns before reading `trx`: an
 * unregistered deployment pays one property read and issues zero SQL. A registered
 * provider gets the strict contract: it must run inside an open transaction.
 *
 * The provider lives on `globalThis` so separately bundled copies of this package
 * (Next server bundle, worker adapters) share one registration.
 *
 * Adoption at native call sites is deliberately not part of this module.
 */
import type { Knex } from 'knex';

export interface WriteAdmissionContext {
  tenant: string;
  /** Stable operation name, e.g. `workflow-tag-write`. */
  operation: string;
  resource?: string;
}

/** Resolve to admit; throw to refuse. */
export type WriteAdmissionProvider = (trx: Knex.Transaction, context: WriteAdmissionContext) => Promise<void>;

declare global {
  // eslint-disable-next-line no-var
  var __algaWriteAdmissionProvider: WriteAdmissionProvider | undefined;
}

/** Register the single provider. A later registration replaces the earlier one. */
export function registerWriteAdmissionProvider(provider: WriteAdmissionProvider): void {
  globalThis.__algaWriteAdmissionProvider = provider;
}

export function resetWriteAdmissionProvider(): void {
  globalThis.__algaWriteAdmissionProvider = undefined;
}

export async function admitWrite(trx: Knex.Transaction, context: WriteAdmissionContext): Promise<void> {
  const provider = globalThis.__algaWriteAdmissionProvider;
  if (!provider) return; // before touching trx
  if (!trx?.isTransaction) throw new Error('Write admission requires an open transaction');
  await provider(trx, context);
}
