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
  /** Every id the scope matches for this caller, no pagination. */
  enumerate: (scope: TScope) => Promise<string[] | ActionFailure>;
  /** The JSON Jev reads for each id. Ids the caller may not read, or that vanished, are simply absent. */
  loadCandidates: (
    trx: Knex.Transaction,
    tenant: string,
    user: IUserWithRoles,
    ids: string[]
  ) => Promise<SmartSearchCandidate[]>;
  /** List rows for ids, through the same authorization and enrichment as the list page. */
  hydrateRows: (scope: TScope, ids: string[]) => Promise<SmartSearchRows<TRow, TMetadata> | ActionFailure>;
  rowId: (row: TRow) => string;
  relevance: RelevancePrompt;
}

export type AnySmartSearchEntityDefinition = SmartSearchEntityDefinition<unknown, unknown, unknown>;
