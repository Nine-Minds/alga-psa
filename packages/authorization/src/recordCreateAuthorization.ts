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
import {
  builtinClosedFields,
  builtinClosedOperations,
  isBuiltinOperationClosed,
  resolveAppliedBuiltinResolvers,
} from './kernel/builtinRuleResolvers';
import { tenantDb } from '@alga-psa/db';
import { projectPeopleForSubject, type ProjectedPersonKind } from './subject/peopleProjection';

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
  /** Rows the record points at that must belong to its own client; see `assertRecordCreateAllowed`. */
  references?: readonly ClientOwnedReference[];
}

/** A reference a written record makes to a row that must belong to the record's own client (a ticket's contact). */
export interface ClientOwnedReference {
  table: string;
  idColumn: string;
  clientColumn: string;
  id: string | null | undefined;
}

const ALLOWED: AuthorizationMutationDecision = Object.freeze({ allowed: true, reasons: [] });

export async function authorizeRecordCreate(
  conn: Knex | Knex.Transaction,
  input: AuthorizeRecordCreateInput,
  action: string = 'create'
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
    resource: { type: input.resourceType, action },
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

/**
 * Whether a subject a built-in rule resolver governs (a co-managed seat technician) may create records of
 * `resourceType` at all. For a resource that has no owning record to point at (a tag definition: it belongs to the
 * tenant until something is mapped to it), where the question is whether the resolver's closed baseline grants the
 * action, not whether this record is in scope.
 *
 * Neutral for everyone else: a client principal, a tenant no resolver has a subject in, and a subject no resolver
 * applies to all return true before any rule is read, so bundles and role permissions decide as they always did.
 */
export async function isResolverGovernedCreateAllowed(
  conn: Knex | Knex.Transaction,
  input: { tenant: string; user: SubjectUserInput; resourceType: string; requestCache?: AuthorizationRequestCache },
): Promise<boolean> {
  return isResolverGovernedActionAllowed(conn, { ...input, action: 'create' });
}

/**
 * Whether a subject a built-in rule resolver governs may take `action` on a resource type at all, asked of the
 * resolver's closed baseline rather than of one record (tag definitions: a seat technician reads them and may not
 * update or delete them). Neutral for everyone else, exactly like `isResolverGovernedCreateAllowed`.
 */
export async function isResolverGovernedActionAllowed(
  conn: Knex | Knex.Transaction,
  input: { tenant: string; user: SubjectUserInput; resourceType: string; action: string; requestCache?: AuthorizationRequestCache },
): Promise<boolean> {
  const requestCache = input.requestCache ?? new RequestLocalAuthorizationCache();
  const governed = await resolverGovernedEvaluation(conn, { ...input, record: {}, requestCache });
  if (!governed) return true;
  return (await authorizeRecordCreate(conn, { ...input, record: {}, requestCache }, input.action)).allowed;
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

/**
 * The one "is this subject governed by a built-in rule resolver (a co-managed seat technician)?" gate, shared by every
 * write check that only a governed subject is held to. Returns the subject's evaluation input for `record`, or null for
 * everyone else. Neutral: a client principal, or a tenant the cached probe says no resolver has a subject in, returns
 * before the subject is loaded, and a subject no registered resolver applies to returns before any rule is read.
 */
export async function resolverGovernedEvaluation(
  conn: Knex | Knex.Transaction,
  input: { tenant: string; user: SubjectUserInput; resourceType: string; action: string; record: AuthorizationRecord; requestCache?: AuthorizationRequestCache },
) {
  if (isClientUserType(input.user.user_type)) return null;
  const requestCache = input.requestCache ?? new RequestLocalAuthorizationCache();
  const tenantScope = await probeTenantAuthorizationScope(conn, input.tenant, requestCache);
  if (tenantScope.resolverSubjects === false) return null;
  const subject = await resolveAuthorizationSubject(conn, { tenant: input.tenant, user: input.user, requestCache });
  const evaluation = { subject, resource: { type: input.resourceType, action: input.action }, record: input.record, requestCache, knex: conn };
  return resolveAppliedBuiltinResolvers(evaluation).length > 0 ? evaluation : null;
}

/**
 * Throws `RecordCreateDeniedError` (`Permission denied: Cannot create <label>`) when the subject may not create the
 * candidate record, or, for a subject a built-in rule resolver governs (a co-managed seat technician), when a row the
 * candidate points at (`references`: a ticket's contact) does not belong to the candidate's own client. The reference
 * is read from the database, never taken from the request, and nothing is read for a subject no resolver governs.
 */
export async function assertRecordCreateAllowed(
  conn: Knex | Knex.Transaction,
  input: AuthorizeRecordCreateInput,
  label: string = input.resourceType
): Promise<void> {
  const requestCache = input.requestCache ?? new RequestLocalAuthorizationCache();
  const decision = await authorizeRecordCreate(conn, { ...input, requestCache });
  if (!decision.allowed) throw new RecordCreateDeniedError(input.resourceType, label);

  const references = (input.references ?? []).filter((reference) => reference.id);
  if (references.length === 0 || typeof input.record === 'function') return;
  const governed = await resolverGovernedEvaluation(conn, {
    tenant: input.tenant, user: input.user, resourceType: input.resourceType, action: 'create', record: input.record, requestCache,
  });
  if (!governed) return;
  for (const reference of references) {
    const row = await tenantDb(conn, input.tenant).table(reference.table)
      .where(reference.idColumn, reference.id as string).first(reference.clientColumn);
    if (!row || !input.record.clientId || row[reference.clientColumn] !== input.record.clientId) {
      throw new RecordCreateDeniedError(input.resourceType, label);
    }
  }
}

export interface DocumentAssociationTarget {
  entityType: string;
  entityId: string;
}

async function candidateTicket(
  conn: Knex | Knex.Transaction,
  tenant: string,
  ticketId: string
): Promise<Array<{ clientId: string | null; boardId: string | null }>> {
  const ticket = await tenantDb(conn, tenant).table('tickets').where({ ticket_id: ticketId }).first('client_id', 'board_id');
  return ticket ? [{ clientId: ticket.client_id ?? null, boardId: ticket.board_id ?? null }] : [];
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
        // The ticket the document is being attached to, for the seat resolver's ticket-scope guard. Read only
        // when a rule could apply (this function is lazy), so an ordinary tenant pays nothing for it.
        attachedTickets: entityType === 'ticket' ? await candidateTicket(conn, input.tenant, entityId) : [],
      }),
      requestCache,
    });
    if (!decision.allowed) return false;
  }
  return true;
}

/** The record a write is made on is governed through a parent resource the subject's rules refuse. */
export class ParentResourceDeniedError extends Error {
  constructor(readonly resourceType: string, label: string) {
    super(`Permission denied: Cannot write ${label}`);
    this.name = 'ParentResourceDeniedError';
  }
}

export function isParentResourceDeniedError(error: unknown): error is ParentResourceDeniedError {
  return error instanceof Error && error.name === 'ParentResourceDeniedError';
}

/**
 * A write on a record of a polymorphic kind (a time entry, a document or tag association on a project task) is
 * also a write on the parent resource that kind is governed through. This asks the kernel whether the subject may
 * UPDATE that parent, so the rules that narrow it (a seat technician's shared projects) hold for the child too,
 * whatever the child's own rules say about its client.
 *
 * The parent comes from the same path as the client (`ClientPath.parent`, `clientResolvers.resolveParent`), so a
 * kind cannot be given a client without its parent being decided. A kind with no parent resource returns before
 * anything is read. Only a subject a built-in rule resolver governs is held to it: for every other subject this
 * returns after the cached tenant probe, adding no statement to a tenant with no seat technician. It is a
 * mutation decision, so the seat write admission gate (lapse) applies as well.
 */
export async function assertWorkItemParentAllowed(
  conn: Knex | Knex.Transaction,
  input: {
    tenant: string;
    user: SubjectUserInput;
    resolver: string;
    discriminator: string | null | undefined;
    id: string | null | undefined;
    requestCache?: AuthorizationRequestCache;
  },
  label: string,
): Promise<void> {
  if (!input.discriminator || !input.id) return;
  const parentType = clientResolvers.parentResource(input.resolver, input.discriminator);
  if (!parentType) return;
  const requestCache = input.requestCache ?? new RequestLocalAuthorizationCache();
  const governed = await resolverGovernedEvaluation(conn, {
    tenant: input.tenant, user: input.user, resourceType: parentType, action: 'update', record: { id: input.id }, requestCache,
  });
  if (!governed) return;
  const parent = await clientResolvers.resolveParent(conn, input.tenant, input.resolver, input.discriminator, input.id);
  // A record whose parent cannot be found is not one a governed subject may write.
  if (!parent) throw new ParentResourceDeniedError(parentType, label);
  const evaluation = { ...governed, record: { id: parent.id, clientId: parent.clientId, ownerUserId: null, assignedUserIds: [] } };
  const rules = await resolveBundleNarrowingRulesForEvaluation(conn, evaluation);
  const kernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider(),
    bundleProvider: new BundleAuthorizationKernelProvider({ resolveRules: async () => rules }),
    rbacEvaluator: async () => true,
  });
  if (!(await kernel.authorizeMutation(evaluation)).allowed) throw new ParentResourceDeniedError(parentType, label);
}

/**
 * What a built-in rule resolver closes on a resource type to this user: the columns its reads leave out and the
 * operations no kernel action covers (opening the service catalog from a project form, say). Both empty for every
 * user no resolver governs, which costs no statement beyond the cached tenant probe, so an ordinary MSP screen asks
 * freely. A screen takes this as data and omits what is closed; the action layer refuses the same operations with
 * `assertResourceOperationOpen`.
 */
export async function resolveResourceSurface(
  conn: Knex | Knex.Transaction,
  input: { tenant: string; user: SubjectUserInput; resourceType: string; requestCache?: AuthorizationRequestCache },
): Promise<{ closedFields: string[]; closedOperations: string[] }> {
  const governed = await resolverGovernedEvaluation(conn, {
    tenant: input.tenant, user: input.user, resourceType: input.resourceType, action: 'read', record: {}, requestCache: input.requestCache,
  });
  if (!governed) return { closedFields: [], closedOperations: [] };
  return { closedFields: builtinClosedFields(governed), closedOperations: builtinClosedOperations(governed) };
}

/** Throws the kernel's standard denial when a built-in resolver closes `operation` on `resourceType` to the user. */
export async function assertResourceOperationOpen(
  conn: Knex | Knex.Transaction,
  input: { tenant: string; user: SubjectUserInput; resourceType: string; operation: string; requestCache?: AuthorizationRequestCache },
  label: string = input.resourceType,
): Promise<void> {
  const governed = await resolverGovernedEvaluation(conn, {
    tenant: input.tenant, user: input.user, resourceType: input.resourceType, action: input.operation, record: {}, requestCache: input.requestCache,
  });
  if (!governed) return;
  if (isBuiltinOperationClosed({ subject: governed.subject, resource: { type: input.resourceType, action: input.operation } })) {
    throw new Error(`Permission denied: Cannot ${input.operation.replace(/_/g, ' ')} on ${label}`);
  }
}

/** Whether a built-in rule resolver governs this user (a co-managed seat technician). Neutral like `resolverGovernedEvaluation`. */
export async function isResolverGovernedUser(
  conn: Knex | Knex.Transaction,
  input: { tenant: string; user: SubjectUserInput; requestCache?: AuthorizationRequestCache },
): Promise<boolean> {
  return (await resolverGovernedEvaluation(conn, {
    tenant: input.tenant, user: input.user, resourceType: 'project', action: 'update', record: {}, requestCache: input.requestCache,
  })) !== null;
}

/**
 * Whether the person an actor assigns work to is one the actor may see. A subject whose people are projected (a seat
 * technician sees MSP staff on their tickets, their client's technicians and its contacts) may assign only to the
 * kinds the caller names, and only among the people the projection lists, so an assignee outside it is refused
 * whatever the request names. A subject nothing projects returns before any people are read.
 *
 * This decides who the ACTOR may name. Whether the assignee may be given the work at all (an active licensed user,
 * a seat technician only on their own client's shared work) is `assertHumanWorkAssignee`, which callers keep.
 */
export async function assertAssigneesInActorProjection(
  conn: Knex | Knex.Transaction,
  input: {
    tenant: string;
    user: SubjectUserInput;
    assigneeIds: ReadonlyArray<string | null | undefined>;
    kinds: readonly ProjectedPersonKind[];
    requestCache?: AuthorizationRequestCache;
  },
  label: string,
): Promise<void> {
  const ids = [...new Set(input.assigneeIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (ids.length === 0) return;
  const governed = await resolverGovernedEvaluation(conn, {
    tenant: input.tenant, user: input.user, resourceType: 'project', action: 'update', record: {}, requestCache: input.requestCache,
  });
  if (!governed) return;
  const people = await projectPeopleForSubject(conn, governed.subject, { kinds: input.kinds });
  if (people === null) return;
  const visible = new Set(people.flatMap((person) => (person.userId ? [person.userId] : [])));
  if (ids.some((id) => !visible.has(id))) throw new Error(`Permission denied: Cannot assign ${label}`);
}
