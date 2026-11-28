import type { Knex } from 'knex';
import type { IUser } from '@alga-psa/types';
import { hasPermission } from './rbac';

/**
 * The billing columns of a client record: payment terms, billing cycle, credit limit and the
 * invoicing settings (`clients` table, `IClient`). Enumerated here and nowhere else.
 *
 * `credit_balance` is not stored on `clients`; readers derive it from credit tracking and attach
 * it to the row, so it is hidden with the stored credit settings.
 */
export const CLIENT_BILLING_COLUMNS = [
  'billing_type',
  'payment_terms',
  'billing_cycle',
  'credit_limit',
  'credit_balance',
  'preferred_payment_method',
  'auto_invoice',
  'invoice_delivery_method',
  'invoice_template_id',
  'billing_contact_id',
  'billing_email',
] as const;

export type ClientBillingColumn = (typeof CLIENT_BILLING_COLUMNS)[number];

/**
 * The permission that lets a subject see a client's billing columns, in its own scope. Exported so a
 * hot path that already loads the subject's roles can evaluate it in the same
 * `checkMultiplePermissions` call and then apply `omitClientBillingColumns` itself.
 */
export const CLIENT_BILLING_PERMISSION = { resource: 'billing', action: 'read' } as const;

/** The subject may see a client's billing columns when it holds `billing:read` in its own scope. */
export async function canReadClientBilling(
  user: IUser,
  knexConnection?: Knex | Knex.Transaction,
): Promise<boolean> {
  return hasPermission(user, CLIENT_BILLING_PERMISSION.resource, CLIENT_BILLING_PERMISSION.action, knexConnection);
}

/** Pure: a copy of `client` without the billing columns. */
export function omitClientBillingColumns<T extends object>(client: T): T {
  const copy: Record<string, unknown> = { ...(client as Record<string, unknown>) };
  for (const column of CLIENT_BILLING_COLUMNS) delete copy[column];
  return copy as T;
}

/**
 * Client rows leave the server through this projection: a subject without billing permission gets
 * them without the billing columns; a permitted subject gets the same objects back untouched.
 *
 * Returns the input type. The type does not model the missing keys, because `IClient` declares
 * some of them required and every reader already treats them as absent-able on a client row.
 */
export async function projectClientForSubject<T extends object>(
  user: IUser,
  client: T,
  knexConnection?: Knex | Knex.Transaction,
): Promise<T>;
export async function projectClientForSubject<T extends object>(
  user: IUser,
  client: T | null,
  knexConnection?: Knex | Knex.Transaction,
): Promise<T | null>;
export async function projectClientForSubject<T extends object>(
  user: IUser,
  client: T | null,
  knexConnection?: Knex | Knex.Transaction,
): Promise<T | null> {
  if (!client) return client;
  if (await canReadClientBilling(user, knexConnection)) return client;
  return omitClientBillingColumns(client);
}

/** `projectClientForSubject` for a list: one permission lookup for the whole list. */
export async function projectClientsForSubject<T extends object>(
  user: IUser,
  clients: readonly T[],
  knexConnection?: Knex | Knex.Transaction,
): Promise<T[]> {
  if (clients.length === 0) return clients as T[];
  if (await canReadClientBilling(user, knexConnection)) return clients as T[];
  return clients.map(omitClientBillingColumns);
}

/** The permission that lets a subject change a client's billing columns, in its own scope. */
export const CLIENT_BILLING_WRITE_PERMISSION = { resource: 'billing', action: 'update' } as const;

/** The subject may change a client's billing columns when it holds `billing:update` in its own scope. */
export async function canWriteClientBilling(
  user: IUser,
  knexConnection?: Knex | Knex.Transaction,
): Promise<boolean> {
  return hasPermission(user, CLIENT_BILLING_WRITE_PERMISSION.resource, CLIENT_BILLING_WRITE_PERMISSION.action, knexConnection);
}

const NUMERIC_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/** Writers store `''` and `undefined` as null, so compare them as null. */
function normalizeBillingValue(value: unknown): unknown {
  return value === undefined || value === '' ? null : value;
}

function billingValuesEqual(next: unknown, stored: unknown): boolean {
  const a = normalizeBillingValue(next);
  const b = normalizeBillingValue(stored);
  if (a === null || b === null) return a === b;
  if (a instanceof Date || b instanceof Date) {
    const at = a instanceof Date ? a.getTime() : new Date(a as string | number).getTime();
    const bt = b instanceof Date ? b.getTime() : new Date(b as string | number).getTime();
    return !Number.isNaN(at) && at === bt;
  }
  const isNumeric = (v: unknown) =>
    (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && NUMERIC_TEXT.test(v.trim()));
  // Postgres returns decimals as strings: "500.00" is the same value as 500.
  if (isNumeric(a) && isNumeric(b)) {
    return Number(a) === Number(b);
  }
  if (typeof a === 'object' || typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
}

/**
 * Pure: which billing columns `update` would actually change against the `existing` row.
 * A key counts as changed when it is present in `update` and its value differs from the stored one.
 * A present value equal to the stored value is grandfathered, so a full-record round-trip still saves.
 * `credit_balance` is not a stored column and is ignored. Keys absent from `update` are not changes.
 */
export function partitionClientBillingWrite(
  update: Record<string, unknown>,
  existing: Record<string, unknown>,
): { changedBillingFields: ClientBillingColumn[]; nonBillingUpdate: Record<string, unknown> } {
  const changedBillingFields: ClientBillingColumn[] = [];
  const nonBillingUpdate: Record<string, unknown> = {};
  const billing = new Set<string>(CLIENT_BILLING_COLUMNS);
  for (const [key, value] of Object.entries(update)) {
    if (!billing.has(key)) {
      nonBillingUpdate[key] = value;
      continue;
    }
    if (key === 'credit_balance') continue;
    if (!billingValuesEqual(value, existing[key])) changedBillingFields.push(key as ClientBillingColumn);
  }
  return { changedBillingFields, nonBillingUpdate };
}
