import type { Knex } from 'knex';
import type {
  AuthorizationRequestCache,
  AuthorizationSubject,
  RelationshipTemplateKey,
} from '../kernel/contracts';
import { RequestLocalAuthorizationCache } from '../kernel/requestCache';
import {
  BundleAuthorizationKernelProvider,
  type BundleNarrowingRule,
} from '../kernel/providers/bundleProvider';
import { resolveBundleNarrowingRulesForEvaluation } from '../bundles/service';
import { resolveAuthorizationSubject } from './resolver';
import { probeTenantAuthorizationScope } from './tenantScope';
import type { SubjectUserInput } from './assemble';

// ---------------------------------------------------------------------------
// Readable scope: which clients and boards a subject's bundle rules let them read.
//
// A SQL surface that cannot call the kernel per row (search ranks and counts in one
// statement) needs the answer as a set. This derives the set FROM the kernel's bundle
// provider, so it cannot drift from what the record-level checks decide: each candidate
// is put through the same `evaluateNarrowing` the record checks use, with the subject's
// own rules, in memory.
//
// Only the client facet (`selected_clients`, `client_portfolio`, `same_client`) and the
// board facet (`selected_boards`) are readable as a set. Rules on other templates
// (`own`, `assigned`, ...) narrow by who the record belongs to and cannot be expressed as
// a client or board set; they are ignored here, as they are for any set-shaped reader.
// ---------------------------------------------------------------------------

const CLIENT_TEMPLATES: readonly RelationshipTemplateKey[] = ['selected_clients', 'client_portfolio', 'same_client'];
const BOARD_TEMPLATES: readonly RelationshipTemplateKey[] = ['selected_boards'];

/** An id that cannot name a real client or board: probes "does this resource restrict at all". */
const NO_SUCH_ID = '00000000-0000-0000-0000-000000000000';

export interface ReadableScope {
  /** Clients the subject may read on every named resource; null when no named resource restricts clients. */
  clientIds: string[] | null;
  /** Boards the subject may read tickets from; null when ticket reads are not restricted by board. */
  boardIds: string[] | null;
}

export const UNRESTRICTED_READABLE_SCOPE: ReadableScope = Object.freeze({ clientIds: null, boardIds: null });

export interface ResolveReadableScopeInput {
  tenant: string;
  user: SubjectUserInput;
  /** Resources whose `read` rules bound the clients the subject may see. */
  clientResources: readonly string[];
  /** Resource whose `read` rules bound the boards the subject may see (tickets). */
  boardResource?: string;
  requestCache?: AuthorizationRequestCache;
}

/** Keep only the rules of one facet; every other rule keeps its place (it still names the resource and its baseline) but narrows nothing. */
function onlyFacet(rules: readonly BundleNarrowingRule[], keep: readonly RelationshipTemplateKey[]): BundleNarrowingRule[] {
  return rules.map((rule) =>
    rule.templateKey && keep.includes(rule.templateKey)
      ? { ...rule, constraintKey: null }
      : { ...rule, templateKey: null, constraintKey: null },
  );
}

async function allowedIds(
  rules: BundleNarrowingRule[],
  subject: AuthorizationSubject,
  resource: string,
  candidates: readonly string[],
  record: (id: string) => { clientId?: string; boardId?: string },
): Promise<string[] | null> {
  const provider = new BundleAuthorizationKernelProvider({ resolveRules: async () => rules });
  const evaluate = async (id: string) =>
    !(await provider.evaluateNarrowing({ subject, resource: { type: resource, action: 'read' }, record: record(id) })).scope.denied;

  // A resource this facet does not restrict allows the probe id too.
  if (await evaluate(NO_SUCH_ID)) return null;
  const allowed: string[] = [];
  for (const id of new Set(candidates)) if (await evaluate(id)) allowed.push(id);
  return allowed.sort();
}

function intersect(sets: Array<string[] | null>): string[] | null {
  const restricting = sets.filter((set): set is string[] => set !== null);
  if (restricting.length === 0) return null;
  return restricting.reduce((acc, set) => acc.filter((id) => set.includes(id)));
}

/**
 * The clients and boards `user` may read. A tenant with no published bundle assignment is
 * answered by the one cached probe and returns unrestricted without loading the subject or any rule.
 */
export async function resolveReadableScope(
  knex: Knex | Knex.Transaction,
  input: ResolveReadableScopeInput,
): Promise<ReadableScope> {
  const requestCache = input.requestCache ?? new RequestLocalAuthorizationCache();
  const tenantScope = await probeTenantAuthorizationScope(knex, input.tenant, requestCache);
  if (!tenantScope.publishedAssignments) return UNRESTRICTED_READABLE_SCOPE;

  const subject = await resolveAuthorizationSubject(knex, { tenant: input.tenant, user: input.user, requestCache });
  const rules = await resolveBundleNarrowingRulesForEvaluation(knex, {
    subject,
    resource: { type: input.clientResources[0] ?? 'ticket', action: 'read' },
    requestCache,
  });
  if (rules.length === 0) return UNRESTRICTED_READABLE_SCOPE;

  const clientRules = onlyFacet(rules, CLIENT_TEMPLATES);
  const subjectClients = [...(subject.portfolioClientIds ?? []), ...(subject.clientId ? [subject.clientId] : [])];
  const perResource: Array<string[] | null> = [];
  for (const resource of input.clientResources) {
    const named = rules.filter((rule) => rule.resource === resource && rule.templateKey === 'selected_clients')
      .flatMap((rule) => rule.selectedClientIds ?? []);
    perResource.push(
      await allowedIds(clientRules, subject, resource, [...named, ...subjectClients], (clientId) => ({ clientId })),
    );
  }

  let boardIds: string[] | null = null;
  if (input.boardResource) {
    const boardRules = onlyFacet(rules, BOARD_TEMPLATES);
    const named = rules.filter((rule) => rule.resource === input.boardResource && rule.templateKey === 'selected_boards')
      .flatMap((rule) => rule.selectedBoardIds ?? []);
    boardIds = await allowedIds(boardRules, subject, input.boardResource, named, (boardId) => ({ boardId }));
  }

  return { clientIds: intersect(perResource), boardIds };
}
