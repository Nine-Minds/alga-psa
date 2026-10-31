import type { Knex } from 'knex';
import type { CoManagedSessionActor } from './sharedWorkIdentity';
import type { CoManagedPortableSnapshot } from './portableSnapshot';
import type { PortableStagedBlob } from './portableBlobStaging';
import type { PortableRecordReference, PortableRecords } from './portableRecordValidation';

/**
 * The portable-domain contributor contract (DAG-REPORT R15).
 *
 * A domain joins a portable workspace by registering ONE of these; the engine
 * (portableWorkspaceGraph / portableWorkspaceManifest) never names a domain.
 * The contract is exactly: references, columns, export, retain, validate.
 * `id`, `version` and `reason` only identify the contributor and say, in the
 * manifest, why its rows are included.
 */
export interface PortableContributor {
  readonly id: string;
  readonly version: number;
  /** Recorded in the manifest as the inclusion reason of every row/file this contributor emits. */
  readonly reason: string;
  /** Edges `[table, column, parentTable, parentColumn]`. `table` must be owned by this contributor. */
  readonly references: readonly PortableRecordReference[];
  /** Owned tables and their exact, ordered column projection. New DB columns are never implicitly exported. */
  readonly columns: Readonly<Record<string, readonly string[]>>;
  /** Reads rows (and optionally staged blobs) at the shared snapshot. Tenant-scoped by construction. */
  export(ctx: PortableExportContext): Promise<PortableContribution>;
  /** Re-reads the same rows under the caller's final transaction so the engine can detect a changed source. */
  retain(ctx: PortableRetainContext): Promise<PortableRecordsContribution>;
  /** Throws if the section is invalid. `workspace` is every contributor's rows, for cross-section checks. */
  validate(records: PortableRecords, workspace: PortableRecords): void;
}

export interface PortableExportContext {
  db: Knex; actor: CoManagedSessionActor; packageId: string; snapshot: CoManagedPortableSnapshot;
}
export interface PortableRetainContext { trx: Knex.Transaction; actor: CoManagedSessionActor; packageId: string }
export interface PortableRecordsContribution {
  records: PortableRecords;
  /** Informational, trusted-application metadata carried to restore (policies, dependencies). Not digested into row digests. */
  annotations?: Record<string, unknown>;
}
/** Staged file blobs owned by a contribution. The engine disposes the lease after the archive is sealed. */
export interface PortableBlobLease { files: readonly PortableStagedBlob[]; dispose(): Promise<void> }
export interface PortableContribution extends PortableRecordsContribution { files?: PortableBlobLease }

export class PortableContributorError extends Error {
  constructor(readonly contributor: string, message: string) {
    super(`Portable contributor "${contributor}": ${message}`);
    this.name = 'PortableContributorError';
  }
}

export interface PortableContributorRegistry {
  register(contributor: PortableContributor): void;
  /** Sorted by id so output never depends on registration order. */
  list(): readonly PortableContributor[];
  /** Which contributor owns `table`, if any. */
  owner(table: string): PortableContributor | undefined;
}

const ID = /^[a-z][a-z0-9_-]{0,31}$/;
const IDENT = /^[a-z_][a-z0-9_]*$/;

function checkContract(c: PortableContributor, owners: ReadonlyMap<string, string>) {
  const bad = (message: string): never => { throw new PortableContributorError(String(c?.id), message); };
  if (!c || typeof c.id !== 'string' || !ID.test(c.id)) bad('invalid id');
  if (!Number.isSafeInteger(c.version) || c.version < 1) bad('invalid version');
  if (typeof c.reason !== 'string' || !c.reason.trim()) bad('an inclusion reason is required');
  for (const op of ['export', 'retain', 'validate'] as const) if (typeof c[op] !== 'function') bad(`missing ${op}`);
  if (!c.columns || typeof c.columns !== 'object' || Array.isArray(c.columns)) return bad('missing columns');
  const tables = Object.keys(c.columns);
  if (!tables.length) bad('declares no tables');
  for (const table of tables) {
    const columns = c.columns[table];
    if (!IDENT.test(table) || !Array.isArray(columns) || !columns.length || columns.some(column => typeof column !== 'string' || !IDENT.test(column)) ||
        new Set(columns).size !== columns.length) bad(`invalid columns for ${table}`);
    if (owners.has(table)) bad(`table ${table} is already owned by "${owners.get(table)}"`);
  }
  if (!Array.isArray(c.references)) return bad('missing references');
  for (const reference of c.references) {
    if (!Array.isArray(reference) || reference.length !== 4 || reference.some(part => typeof part !== 'string' || !IDENT.test(part))) bad('malformed reference');
    const [table, column] = reference;
    if (!tables.includes(table) || !(c.columns[table] as readonly string[]).includes(column)) bad(`reference ${table}.${column} is not an owned column`);
  }
}

/** A registry is a contract check plus a table-ownership index. It holds no
 * domain knowledge; composition happens in the graph and manifest. */
export function createPortableContributorRegistry(initial: readonly PortableContributor[] = []): PortableContributorRegistry {
  const contributors = new Map<string, PortableContributor>(), owners = new Map<string, string>();
  const registry: PortableContributorRegistry = {
    register(contributor) {
      checkContract(contributor, owners);
      if (contributors.has(contributor.id)) throw new PortableContributorError(contributor.id, 'is already registered');
      contributors.set(contributor.id, contributor);
      for (const table of Object.keys(contributor.columns)) owners.set(table, contributor.id);
    },
    list: () => [...contributors.values()].sort((a, b) => a.id.localeCompare(b.id)),
    owner: table => contributors.get(owners.get(table) ?? ''),
  };
  for (const contributor of initial) registry.register(contributor);
  return registry;
}
