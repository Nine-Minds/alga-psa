import { AsyncLocalStorage } from 'node:async_hooks';
import type { Knex } from 'knex';
import { tenantDb } from './tenantDb';

/**
 * Capability-owned ("managed") roles: the one server-side guard.
 *
 * A role whose `roles.managed_by` names a capability belongs to that capability. Its definition
 * (`roles`), grants (`role_permissions`) and membership (`user_roles`) change only inside the
 * owner's lifecycle commands, never through general role administration.
 *
 * The decision lives at ONE place: every `tenantDb` write terminal on those three tables runs
 * `admitManagedRoleWrite` before it executes, so server actions, REST services, bulk writers and
 * workers are covered without each carrying a check, and a writer added tomorrow is covered too.
 * Lifecycle code does not pass a flag to a writer; it runs inside `runAsRoleOwner(owner, ...)`,
 * and the guard admits a write to a role only when that role's `managed_by` is the running owner.
 * An owner has no authority over another owner's roles or over ordinary roles' ownership.
 *
 * Identity is reserved as well: creating, importing or renaming another role to a registered
 * capability role's (name, scope), or to the identity of a role that is already managed in the
 * tenant, is refused, so a lookalike can never collide with the managed role. Only a change of
 * identity is a claim: an existing unmanaged role that already holds a reserved identity (a legacy,
 * hand-made look-alike) stays an ordinary, editable role, and saving it with its identity unchanged
 * (including a case or whitespace variant of the same name) is admitted.
 *
 * Tenant teardown is the one other lifecycle the guard understands: `runAsTenantTeardown(tenant, fn)`.
 * Deleting a whole tenant must remove its managed roles, grants and memberships, and no owner is
 * running then. The scope is narrow on purpose: it names ONE tenant, and inside it the guard admits
 * only `del` / `delete` against that tenant. Inserts, updates (so adopting or releasing
 * `managed_by`, renaming, regranting), and deletes against any other tenant are checked exactly as
 * outside it. A delete cannot create, change or take over a managed role, so the scope cannot
 * reopen the hole; it is not a system owner and the guard and `tenantDb` take no flag for it.
 * Only the tenant-deletion activity opens it; nothing reachable from a user request does.
 *
 * Neutral by design: this file knows no capability. Owners register their role identities
 * (`registerManagedRoleIdentity`) from their own package, and the guard reads `managed_by` from
 * the tenant's own rows, so ownership is enforced whether or not the capability is currently
 * visible or served.
 */

/** What a refused write would have changed. Mirrors `ManagedRoleOwnershipCode` in `@alga-psa/types`. */
export type ManagedRoleOwnershipCode =
  | 'MANAGED_ROLE_DEFINITION'
  | 'MANAGED_ROLE_GRANTS'
  | 'MANAGED_ROLE_MEMBERSHIP'
  | 'MANAGED_ROLE_IDENTITY_RESERVED';

/** Builds the refusal the guard throws. Registered by the package that owns the error type. */
export type ManagedRoleRefusalFactory = (code: ManagedRoleOwnershipCode, owner: string, roleIds: readonly string[]) => Error;

export interface ManagedRoleIdentity {
  /** The capability key stored in `roles.managed_by`. */
  owner: string;
  role_name: string;
  msp: boolean;
  client: boolean;
}

interface ManagedRoleState {
  identities: Map<string, ManagedRoleIdentity>;
  lifecycle: AsyncLocalStorage<{ owner: string }>;
  teardown: AsyncLocalStorage<{ tenant: string }>;
  refusal?: ManagedRoleRefusalFactory;
}

declare global {
  // eslint-disable-next-line no-var
  var __algaManagedRoleState: ManagedRoleState | undefined;
}

// On globalThis so separately bundled copies of this package share one registry and one scope.
function state(): ManagedRoleState {
  return (globalThis.__algaManagedRoleState ??= {
    identities: new Map(),
    lifecycle: new AsyncLocalStorage(),
    teardown: new AsyncLocalStorage(),
  });
}

/**
 * The refusal is built by the registering package: this file sits in `tenantDb`'s import chain,
 * which the e2e harness and raw Node ESM consumers load without workspace-package resolution, so
 * it never imports the package that owns `ManagedRoleOwnershipError` (same rule as `writeAdmission`).
 * Idempotent; the last registration wins.
 */
export function registerManagedRoleRefusal(factory: ManagedRoleRefusalFactory): void {
  state().refusal = factory;
}

/**
 * The refusal used when nothing is registered. It still refuses, and carries the same `name`,
 * `statusCode`, `code`, `owner` and `roleIds`, so `isManagedRoleOwnershipError` recognises it
 * by name. A missing registration must never let a write through.
 */
function fallbackRefusal(code: ManagedRoleOwnershipCode, owner: string, roleIds: readonly string[]): Error {
  return Object.assign(new Error('This role is managed by the system and cannot be changed here.'), {
    name: 'ManagedRoleOwnershipError', statusCode: 409, code, owner, roleIds,
  });
}

export const MANAGED_ROLE_TABLES = ['roles', 'role_permissions', 'user_roles'] as const;
export type ManagedRoleTable = (typeof MANAGED_ROLE_TABLES)[number];

export function isManagedRoleTable(table: string): table is ManagedRoleTable {
  return (MANAGED_ROLE_TABLES as readonly string[]).includes(table);
}

const identityKey = (role: { role_name: string; msp: boolean; client: boolean }): string =>
  `${role.msp ? 'msp' : '-'}${role.client ? 'client' : '-'}:${String(role.role_name).trim().toLowerCase()}`;

/** Idempotent. Called by the owning package at import, so every host that loads it reserves the identity. */
export function registerManagedRoleIdentity(identity: ManagedRoleIdentity): void {
  state().identities.set(`${identity.owner}|${identityKey(identity)}`, identity);
}

export function registeredManagedRoleIdentities(): readonly ManagedRoleIdentity[] {
  return [...state().identities.values()];
}

/** Runs `fn` as the lifecycle of `owner`: its writes to roles that owner manages are admitted. */
export function runAsRoleOwner<T>(owner: string, fn: () => PromiseLike<T>): Promise<T> {
  // Awaited inside the scope: a lazy knex builder runs (and is checked) when awaited, not when built.
  return state().lifecycle.run({ owner }, async () => await fn());
}

/** The owner whose lifecycle is running in this async scope, if any. */
export function currentRoleOwner(): string | undefined {
  return state().lifecycle.getStore()?.owner;
}

/**
 * Runs `fn` as the teardown of `tenant`: inside it, DELETES of that tenant's role, grant and
 * membership rows are admitted, managed or not. Nothing else is: see the file header. Only the
 * tenant-deletion activity may call this.
 */
export function runAsTenantTeardown<T>(tenant: string, fn: () => PromiseLike<T>): Promise<T> {
  return state().teardown.run({ tenant }, async () => await fn());
}

/** The tenant whose teardown is running in this async scope, if any. */
export function currentTeardownTenant(): string | undefined {
  return state().teardown.getStore()?.tenant;
}

interface ManagedRoleRow {
  role_id: string;
  role_name: string;
  msp: boolean;
  client: boolean;
  managed_by: string | null;
}

/** The tenant's managed roles. Reads are never guarded. */
export async function listManagedRoles(
  conn: Knex | Knex.Transaction,
  tenant: string,
): Promise<Array<ManagedRoleRow & { managed_by: string }>> {
  return await tenantDb(conn, tenant).table('roles')
    .whereNotNull('managed_by')
    .select('role_id', 'role_name', 'msp', 'client', 'managed_by');
}

export interface ManagedRoleWrite {
  conn: Knex | Knex.Transaction;
  tenant: string;
  table: ManagedRoleTable;
  method: 'insert' | 'update' | 'del' | 'delete' | 'truncate' | 'increment' | 'decrement';
  /** `_single.insert` / `_single.update` of the builder about to run. */
  insert?: unknown;
  update?: unknown;
  /** A SELECT builder over the same rows the write will touch (update / delete only). */
  probe?: Knex.QueryBuilder;
  rootAlias: string;
}

const asRows = (value: unknown): Array<Record<string, any>> =>
  (Array.isArray(value) ? value : value == null ? [] : [value]).filter((row) => row && typeof row === 'object');

const tableCode = (table: ManagedRoleTable): ManagedRoleOwnershipCode =>
  table === 'roles' ? 'MANAGED_ROLE_DEFINITION' : table === 'role_permissions' ? 'MANAGED_ROLE_GRANTS' : 'MANAGED_ROLE_MEMBERSHIP';

/**
 * Throws `ManagedRoleOwnershipError` when the write would change a managed role (or take its
 * identity) outside its owner's lifecycle. Resolves otherwise. Runs in the writer's own
 * transaction, before the write.
 */
export async function admitManagedRoleWrite(write: ManagedRoleWrite): Promise<void> {
  const { conn, tenant, table, method } = write;
  if (method !== 'insert' && method !== 'update' && method !== 'del' && method !== 'delete') return;
  // Teardown of this very tenant removes rows; it never writes or reassigns them.
  if ((method === 'del' || method === 'delete') && currentTeardownTenant() === tenant) return;
  const running = currentRoleOwner();
  const managed = new Map((await listManagedRoles(conn, tenant)).map((role) => [role.role_id, role]));

  const refuse = (code: ManagedRoleOwnershipCode, owner: string, roleIds: string[] = []): never => {
    throw (state().refusal ?? fallbackRefusal)(code, owner, roleIds);
  };
  const ownedBy = (roleId: string): string | undefined => managed.get(roleId)?.managed_by;
  const assertMayWrite = (roleIds: Iterable<string>, code: ManagedRoleOwnershipCode): void => {
    for (const roleId of roleIds) {
      const owner = ownedBy(roleId);
      if (owner && owner !== running) refuse(code, owner, [roleId]);
    }
  };

  // Identities reserved against everyone but their owner: registered ones, and managed rows.
  const reserved = new Map<string, string>();
  for (const identity of registeredManagedRoleIdentities()) reserved.set(identityKey(identity), identity.owner);
  for (const role of managed.values()) reserved.set(identityKey(role), role.managed_by!);
  const assertIdentityFree = (identity: { role_name: string; msp: boolean; client: boolean }): void => {
    const owner = reserved.get(identityKey(identity));
    if (owner && owner !== running) refuse('MANAGED_ROLE_IDENTITY_RESERVED', owner);
  };

  if (write.table !== 'roles') {
    const code = tableCode(table);
    if (method === 'insert') {
      assertMayWrite(asRows(write.insert).map((row) => String(row.role_id)), code);
      return;
    }
    if (method === 'update') assertMayWrite(asRows(write.update).flatMap((row) => row.role_id ? [String(row.role_id)] : []), code);
    if (managed.size === 0 || !write.probe) return;
    const affected: Array<{ role_id: string }> = await write.probe.clone().clearSelect().clearOrder()
      .select({ role_id: `${write.rootAlias}.role_id` });
    assertMayWrite(affected.map((row) => row.role_id), code);
    return;
  }

  // roles: definition and identity.
  if (method === 'insert') {
    for (const row of asRows(write.insert)) {
      if (row.managed_by != null && row.managed_by !== running) refuse('MANAGED_ROLE_DEFINITION', String(row.managed_by));
      if (row.role_name == null) continue;
      assertIdentityFree({ role_name: String(row.role_name), msp: row.msp ?? true, client: row.client ?? false });
    }
    return;
  }

  const values = method === 'update' ? asRows(write.update)[0] ?? {} : {};
  if (method === 'update' && 'managed_by' in values && values.managed_by !== running && !(values.managed_by === undefined)) {
    // Neither adopting a role nor releasing one is general administration.
    refuse('MANAGED_ROLE_DEFINITION', String(values.managed_by ?? running ?? 'system'));
  }
  const changesIdentity = method === 'update' && ('role_name' in values || 'msp' in values || 'client' in values);
  if (!write.probe || (managed.size === 0 && !changesIdentity)) return;
  const affected: ManagedRoleRow[] = await write.probe.clone().clearSelect().clearOrder().select({
    role_id: `${write.rootAlias}.role_id`, role_name: `${write.rootAlias}.role_name`,
    msp: `${write.rootAlias}.msp`, client: `${write.rootAlias}.client`, managed_by: `${write.rootAlias}.managed_by`,
  });
  assertMayWrite(affected.map((row) => row.role_id), 'MANAGED_ROLE_DEFINITION');
  if (changesIdentity) {
    for (const row of affected) {
      const resulting = {
        role_name: String(values.role_name ?? row.role_name),
        msp: values.msp ?? row.msp,
        client: values.client ?? row.client,
      };
      // Reserving an identity stops a role from newly claiming it. A row that already holds it and
      // is not managed is a legacy role; resubmitting its unchanged identity is not a claim.
      if (identityKey(resulting) === identityKey(row)) continue;
      assertIdentityFree(resulting);
    }
  }
}
