/**
 * Lookup fields: form fields whose option set is resolved from an entity table in a scope derived
 * from the requester, with the entity id as the stored answer.
 *
 * SECURITY BOUNDARY. Scope comes only from the requester context the server built from the session
 * (or the on-behalf-of substitution). No function here accepts a clientId parameter, and none reads
 * one from a request: the browser can post any uuid, so `validateLookupAnswers` is the real control
 * and every answer must resolve inside the field's own option set for this requester.
 *
 * Adding an entity (asset, location) is a new entry in `LOOKUP_ADAPTERS` plus its scope/filter rows in
 * basicFormBuilder.ts; no new branches in the validator, resolver, renderer or ticket text.
 */

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type {
  BasicFormFieldLookup,
  BasicFormLookupEntity,
  BasicFormLookupScope,
} from './basicFormBuilder';

export interface LookupOption {
  id: string;
  label: string;
  secondaryLabel?: string;
}

/** What the server knows about who is submitting. `clientId` is session-derived, never client input. */
export interface LookupRequester {
  clientId: string;
  contactId?: string | null;
}

interface LookupQuery {
  /** Restrict to these ids (validation and label resolution). */
  ids?: string[];
  /** Label resolution shows people who have since been deactivated; options and validation do not. */
  includeInactive?: boolean;
  filters?: Record<string, string | boolean>;
}

interface LookupAdapter {
  /** Loads rows already confined to `scope` for `requester` and the tenant. */
  load(
    knex: Knex | Knex.Transaction,
    tenant: string,
    scope: BasicFormLookupScope,
    requester: LookupRequester,
    query: LookupQuery
  ): Promise<LookupOption[]>;
}

const contactAdapter: LookupAdapter = {
  async load(knex, tenant, scope, requester, query) {
    // Only requester-client exists for contacts; anything else yields nothing rather than widening.
    if (scope !== 'requester-client' || !requester.clientId) {
      return [];
    }
    const builder = tenantDb(knex, tenant)
      .table('contacts')
      .where({ client_id: requester.clientId });
    if (!query.includeInactive) {
      builder.where((inner) => inner.where({ is_inactive: false }).orWhereNull('is_inactive'));
    }
    if (query.ids) {
      builder.whereIn('contact_name_id', query.ids);
    }
    if (query.filters) {
      builder.where(query.filters);
    }
    const rows = (await builder
      .orderBy('full_name', 'asc')
      .select('contact_name_id', 'full_name', 'email', 'role')) as Array<{
      contact_name_id: string;
      full_name: string | null;
      email: string | null;
      role: string | null;
    }>;
    return rows.map((row) => ({
      id: row.contact_name_id,
      label: row.full_name?.trim() || row.email || row.contact_name_id,
      secondaryLabel: row.email ?? row.role ?? undefined,
    }));
  },
};

const userAdapter: LookupAdapter = {
  async load(knex, tenant, scope, _requester, query) {
    if (scope !== 'tenant') {
      return [];
    }
    const builder = tenantDb(knex, tenant).table('users').where({ user_type: 'internal' });
    if (!query.includeInactive) {
      builder.where({ is_inactive: false });
    }
    if (query.ids) {
      builder.whereIn('user_id', query.ids);
    }
    const rows = (await builder
      .orderBy([{ column: 'first_name' }, { column: 'last_name' }])
      .select('user_id', 'first_name', 'last_name', 'email')) as Array<{
      user_id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
    }>;
    return rows.map((row) => ({
      id: row.user_id,
      label: `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || row.email || row.user_id,
      secondaryLabel: row.email ?? undefined,
    }));
  },
};

const LOOKUP_ADAPTERS: Record<BasicFormLookupEntity, LookupAdapter> = {
  contact: contactAdapter,
  user: userAdapter,
};

interface LookupFieldShape {
  key: string;
  type?: unknown;
  label?: unknown;
  lookup?: unknown;
}

// Checked before querying: a malformed uuid in a uuid column raises inside the caller's transaction
// and would abort it, so a non-uuid answer is simply "not an option".
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ResolvedLookupField = { key: string; label: string; lookup: BasicFormFieldLookup };

function asLookupField(field: unknown): ResolvedLookupField | null {
  const f = field as LookupFieldShape | null;
  if (!f || typeof f.key !== 'string' || f.type !== 'lookup') return null;
  const lookup = f.lookup as BasicFormFieldLookup | undefined;
  if (!lookup || typeof lookup.entity !== 'string' || !(lookup.entity in LOOKUP_ADAPTERS)) return null;
  const label = typeof f.label === 'string' && f.label.trim() ? f.label.trim() : f.key;
  return { key: f.key, label, lookup };
}

/** The lookup fields of a published schema, in form order. */
export function listLookupFields(fields: unknown): ResolvedLookupField[] {
  return (Array.isArray(fields) ? fields : []).flatMap((field) => {
    const resolved = asLookupField(field);
    return resolved ? [resolved] : [];
  });
}

/**
 * The options a requester may pick for one lookup. Deliberately no clientId parameter: the client
 * scope is `requester.clientId`, which callers take from the authenticated session.
 */
export async function resolveLookupOptions(
  knex: Knex | Knex.Transaction,
  tenant: string,
  entity: BasicFormLookupEntity,
  scope: BasicFormLookupScope,
  requester: LookupRequester,
  filters?: Record<string, string | boolean>
): Promise<LookupOption[]> {
  const adapter = LOOKUP_ADAPTERS[entity];
  if (!adapter) return [];
  return adapter.load(knex, tenant, scope, requester, { filters });
}

/** Options for every lookup field of a schema, keyed by field key (one query per field). */
export async function resolveLookupOptionsForFields(
  knex: Knex | Knex.Transaction,
  tenant: string,
  fields: unknown,
  requester: LookupRequester
): Promise<Record<string, LookupOption[]>> {
  const result: Record<string, LookupOption[]> = {};
  for (const field of listLookupFields(fields)) {
    result[field.key] = await resolveLookupOptions(
      knex,
      tenant,
      field.lookup.entity,
      field.lookup.scope,
      requester,
      field.lookup.filters
    );
  }
  return result;
}

/**
 * Returns user-facing errors (naming the field by label) for every visible lookup answer that is not
 * inside that field's own option set. Hidden lookups are neither required nor validated; emptiness is
 * the required-field check's job, so an empty answer passes here.
 */
export async function validateLookupAnswers(
  knex: Knex | Knex.Transaction,
  tenant: string,
  fields: unknown,
  payload: Record<string, unknown>,
  requester: LookupRequester,
  visibleFieldKeys: ReadonlySet<string> | readonly string[]
): Promise<string[]> {
  const visible = visibleFieldKeys instanceof Set ? visibleFieldKeys : new Set(visibleFieldKeys);
  const errors: string[] = [];

  for (const field of listLookupFields(fields)) {
    if (!visible.has(field.key)) continue;
    const answer = payload[field.key];
    if (answer === undefined || answer === null || answer === '') continue;
    if (typeof answer !== 'string' || !UUID_PATTERN.test(answer)) {
      errors.push(`Invalid selection for "${field.label}"`);
      continue;
    }
    const matches = await LOOKUP_ADAPTERS[field.lookup.entity].load(
      knex,
      tenant,
      field.lookup.scope,
      requester,
      { ids: [answer], filters: field.lookup.filters }
    );
    if (!matches.some((option) => option.id === answer)) {
      errors.push(`Invalid selection for "${field.label}"`);
    }
  }
  return errors;
}

/**
 * Display labels for the lookup answers in `payload`, keyed by field key. Display only: still
 * confined to the requester's scope, and still resolves people deactivated since the answer was given.
 * Answers that no longer resolve are omitted; renderers decide the fallback.
 */
export async function resolveLookupLabels(
  knex: Knex | Knex.Transaction,
  tenant: string,
  fields: unknown,
  payload: Record<string, unknown>,
  requester: LookupRequester
): Promise<Record<string, string>> {
  const labels: Record<string, string> = {};
  for (const field of listLookupFields(fields)) {
    const answer = payload[field.key];
    if (typeof answer !== 'string' || !UUID_PATTERN.test(answer)) continue;
    const [match] = await LOOKUP_ADAPTERS[field.lookup.entity].load(
      knex,
      tenant,
      field.lookup.scope,
      requester,
      { ids: [answer], includeInactive: true }
    );
    if (match) labels[field.key] = match.label;
  }
  return labels;
}
