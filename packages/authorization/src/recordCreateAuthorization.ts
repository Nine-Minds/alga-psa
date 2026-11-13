import type { Knex } from 'knex';
import { isClientUserType } from '@alga-psa/types';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
  clientResolvers,
  type AuthorizationMutationDecision,
  type AuthorizationRecord,
  type AuthorizationRequestCache,
} from './kernel';
import { resolveBundleNarrowingRulesForEvaluation } from './bundles/service';
import { resolveAuthorizationSubject } from './subject/resolver';
import type { SubjectUserInput } from './subject/assemble';
import { probeTenantAuthorizationScope } from './subject/tenantScope';

/**
 * Create authorization for server actions: "may this subject create THIS record?", asked before anything is
 * written. The kernel evaluates `action: 'create'` against the candidate record (see kernel/candidateRecord.ts),
 * so the bundle, portfolio and closed-baseline rules that govern reading the record decide creating it.
 *
 * Neutral by construction: a tenant with no published bundle assignment (and no registered built-in resolver) is
 * answered by the one cached tenant probe; no subject, portfolio or rule is loaded and the create is allowed.
 * A fault while resolving the subject or the rules propagates: a create that cannot be judged is not allowed.
 */

export interface AuthorizeRecordCreateInput {
  tenant: string;
  user: SubjectUserInput;
  /** Kernel resource type (`ticket`, `contact`, `interaction`, `time_entry`, `document`, `project`, `asset`). */
  resourceType: string;
  /**
   * The record about to be written: above all its owning `clientId`, plus whatever the resource's read rules look
   * at. A function is called only once the tenant is known to have rules that could apply, so resolving the
   * candidate's client costs nothing on the fast path; it may return null when nothing narrows this candidate.
   */
  record: AuthorizationRecord | (() => Promise<AuthorizationRecord | null>);
  requestCache?: AuthorizationRequestCache;
}

const ALLOWED: AuthorizationMutationDecision = Object.freeze({ allowed: true, reasons: [] });

export async function authorizeRecordCreate(
  conn: Knex | Knex.Transaction,
  input: AuthorizeRecordCreateInput
): Promise<AuthorizationMutationDecision> {
  // Client-portal principals create inside their own client through the portal's own paths; this check is for
  // internal (MSP) principals, whose scope bundles and portfolios narrow.
  if (isClientUserType(input.user.user_type)) return ALLOWED;

  const requestCache = input.requestCache ?? new RequestLocalAuthorizationCache();

  const tenantScope = await probeTenantAuthorizationScope(conn, input.tenant, requestCache);
  // Only an explicit "no resolver has a subject here" takes the fast path.
  if (!tenantScope.publishedAssignments && tenantScope.resolverSubjects === false) return ALLOWED;

  const record = typeof input.record === 'function' ? await input.record() : input.record;
  if (record === null) return ALLOWED;

  const subject = await resolveAuthorizationSubject(conn, { tenant: input.tenant, user: input.user, requestCache });
  const evaluation = {
    subject,
    resource: { type: input.resourceType, action: 'create' },
    record,
    requestCache,
    knex: conn,
  };
  const rules = await resolveBundleNarrowingRulesForEvaluation(conn, evaluation);
  const kernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider(),
    bundleProvider: new BundleAuthorizationKernelProvider({
      resolveRules: async () => rules,
    }),
    rbacEvaluator: async () => true,
  });
  return kernel.authorizeMutation(evaluation);
}

/** The subject's rules refuse the candidate record. The message is the permission-denied text callers already surface. */
export class RecordCreateDeniedError extends Error {
  constructor(readonly resourceType: string, label: string) {
    super(`Permission denied: Cannot create ${label}`);
    this.name = 'RecordCreateDeniedError';
  }
}

export function isRecordCreateDeniedError(error: unknown): error is RecordCreateDeniedError {
  return error instanceof Error && error.name === 'RecordCreateDeniedError';
}

/** Throws `RecordCreateDeniedError` (`Permission denied: Cannot create <label>`) when the subject may not create the candidate record. */
export async function assertRecordCreateAllowed(
  conn: Knex | Knex.Transaction,
  input: AuthorizeRecordCreateInput,
  label: string = input.resourceType
): Promise<void> {
  const decision = await authorizeRecordCreate(conn, input);
  if (!decision.allowed) throw new RecordCreateDeniedError(input.resourceType, label);
}

export interface DocumentAssociationTarget {
  entityType: string;
  entityId: string;
}

/**
 * Whether the subject may associate a document with each of `targets`. The candidate document association
 * belongs to the client of the entity it points at (S4 `document_entity` resolver). A kind with no client
 * path (user, team, tenant, a parent document, ...) is not client-owned and is not narrowed by client scope.
 * A client-owned kind whose entity is missing or has no client has no resolvable client: a narrowed subject
 * is refused.
 */
export async function isDocumentAssociationCreateAllowed(
  conn: Knex | Knex.Transaction,
  input: { tenant: string; user: SubjectUserInput; targets: readonly DocumentAssociationTarget[]; requestCache?: AuthorizationRequestCache }
): Promise<boolean> {
  const requestCache = input.requestCache ?? new RequestLocalAuthorizationCache();
  for (const { entityType, entityId } of input.targets) {
    if (!clientResolvers.has('document_entity', entityType)) continue;
    const decision = await authorizeRecordCreate(conn, {
      tenant: input.tenant,
      user: input.user,
      resourceType: 'document',
      record: async () => ({
        clientId: await clientResolvers.resolveClient(conn, input.tenant, 'document_entity', entityType, entityId),
      }),
      requestCache,
    });
    if (!decision.allowed) return false;
  }
  return true;
}
