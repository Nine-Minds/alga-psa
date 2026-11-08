/**
 * What an entity supplies to offer smart search over its list page. The engine
 * (runSmartSearch, the stream route, the access decision, the availability
 * probe) is written once against this; `entities/` holds one definition per
 * entity and `entities/index.ts` the registry the route resolves by name.
 */

import type { Knex } from 'knex';
import type { ZodTypeAny } from 'zod';

import type { IUserWithRoles } from '@alga-psa/types';
import type { SmartSearchEntity, SmartSearchRows } from '@alga-psa/ui/lib/smartSearch/types';
import type { ActionMessageErrorShape, ActionPermissionErrorShape } from '@alga-psa/ui/lib/errorHandling';

import type { SmartSearchCandidate } from './candidate';
import type { RelevancePrompt } from './scoreBatch';

export type ActionFailure = ActionPermissionErrorShape | ActionMessageErrorShape;

/** One enumerated row: its id, and the fields the caller may not see for it (empty or absent when nothing is hidden). */
export interface SmartSearchTarget {
  id: string;
  redactedFields?: readonly string[];
}

/** Redactions by row id, handed to candidate loading and hydration so neither reads what the caller may not see. */
export type SmartSearchRedactions = ReadonlyMap<string, readonly string[]>;

export interface SmartSearchEntityDefinition<TScope, TRow, TMetadata> {
  entity: SmartSearchEntity;
  /** RBAC resource whose `read` action gates the search. */
  permissionResource: string;
  /** Plural noun for messages and logs. */
  noun: string;
  /** Validates the posted scope (chip filters, or an explicit id list). */
  scopeSchema: ZodTypeAny;
  /** Drops any keyword text from the scope: the typed text is the Jev query only. */
  normalizeScope: (scope: TScope) => TScope;
  /** Every row the scope matches for this caller, no pagination, each with its redaction set. */
  enumerate: (scope: TScope) => Promise<SmartSearchTarget[] | ActionFailure>;
  /**
   * The JSON Jev reads for each id, built from what `redactions` leaves visible. Ids the caller may not read,
   * or that vanished, are simply absent.
   */
  loadCandidates: (
    trx: Knex.Transaction,
    tenant: string,
    user: IUserWithRoles,
    ids: string[],
    redactions: SmartSearchRedactions
  ) => Promise<SmartSearchCandidate[]>;
  /** List rows for ids, through the same authorization and enrichment as the list page, masked by `redactions`. */
  hydrateRows: (
    scope: TScope,
    ids: string[],
    redactions: SmartSearchRedactions
  ) => Promise<SmartSearchRows<TRow, TMetadata> | ActionFailure>;
  rowId: (row: TRow) => string;
  relevance: RelevancePrompt;
}

export type AnySmartSearchEntityDefinition = SmartSearchEntityDefinition<unknown, unknown, unknown>;
