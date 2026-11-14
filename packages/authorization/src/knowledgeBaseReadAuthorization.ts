import type { Knex } from 'knex';
import {
  BuiltinAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
  type AuthorizationRequestCache,
  type RelationshipSqlAdapter,
} from './kernel';
import { applyReadScope, resolveNarrowedReadScope } from './readScope';
import { resolveAuthorizationSubject } from './subject/resolver';
import type { SubjectUserInput } from './subject/assemble';
import { probeTenantAuthorizationScope } from './subject/tenantScope';

/**
 * Knowledge base article read authorization.
 *
 * An article has an audience (`internal`, `client`, `public`) and no client column, so the only thing that can
 * narrow a subject's reads is the audience. The rule is the kernel's, not a filter of one list query: a built-in
 * resolver (the co-managed seat) names `knowledge_base_article:read` with the `external_audience_only` record
 * guard, and this module is the adapter that maps the guard onto the article tables, for lists (SQL) and for a
 * single record (JS). Every read surface of articles asks here: server actions, the REST controller and search.
 *
 * Neutral by construction. A user row that says no seat assignment binds the user (`seat_reader === false`) is
 * answered with no statement at all; any other user costs the one cached tenant probe, and only a tenant that
 * has a subject of some built-in resolver goes on to resolve the subject.
 */
export const KNOWLEDGE_BASE_ARTICLE_RESOURCE = 'knowledge_base_article';

const isKnownStaff = (user: SubjectUserInput & { seat_reader?: boolean | null }): boolean => user.seat_reader === false;

/** The SQL mapping of an article: its audience column, nothing else (an article has no owner, client or board). */
export function createKnowledgeBaseArticleSqlAdapter(articleAlias: string): RelationshipSqlAdapter {
  return {
    audienceColumn: `${articleAlias}.audience`,
    applyAssignedUsers: (builder) => builder.whereRaw('1 = 0'),
  };
}

export interface KnowledgeBaseReadScope {
  /** Narrow a query over `kb_articles` (aliased `articleAlias`) to the articles the subject may read. */
  apply(query: Knex.QueryBuilder, articleAlias: string): void;
}

/** The subject's article read scope, or null when nothing narrows it: add no clause. */
export async function resolveKnowledgeBaseReadScope(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: SubjectUserInput & { seat_reader?: boolean | null },
  requestCache?: AuthorizationRequestCache
): Promise<KnowledgeBaseReadScope | null> {
  if (isKnownStaff(user)) return null;
  const scope = await resolveNarrowedReadScope(conn, {
    tenant, user, resourceType: KNOWLEDGE_BASE_ARTICLE_RESOURCE, requestCache,
  });
  if (!scope) return null;
  return {
    apply(query, articleAlias) {
      applyReadScope(query, scope, {
        resourceType: KNOWLEDGE_BASE_ARTICLE_RESOURCE,
        adapter: createKnowledgeBaseArticleSqlAdapter(articleAlias),
      });
    },
  };
}

/**
 * Whether the subject may read this article, decided by the kernel against the article's own record. Used where a
 * single article is checked after it was found (a search hit). A fault while resolving the subject propagates.
 */
export async function canReadKnowledgeBaseArticle(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: SubjectUserInput & { seat_reader?: boolean | null },
  article: { article_id: string; audience: string | null | undefined },
  requestCache: AuthorizationRequestCache = new RequestLocalAuthorizationCache()
): Promise<boolean> {
  if (isKnownStaff(user)) return true;
  const tenantScope = await probeTenantAuthorizationScope(conn, tenant, requestCache);
  if (tenantScope.resolverSubjects === false) return true;

  const subject = await resolveAuthorizationSubject(conn, { tenant, user, requestCache });
  const kernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider({ relationshipRules: [] }),
    rbacEvaluator: async () => true,
  });
  const decision = await kernel.authorizeResource({
    subject,
    resource: { type: KNOWLEDGE_BASE_ARTICLE_RESOURCE, action: 'read', id: article.article_id },
    record: { id: article.article_id, audience: article.audience ?? null },
    requestCache,
    knex: conn,
  });
  return decision.allowed;
}

/**
 * Whether the subject may change articles at all (`create`, `update`, `delete`). Coarse document RBAC stays with
 * the caller. A seat technician's rules grant articles `read` only, so the closed baseline refuses every write; the
 * answer is for the subject, not for one article, because a technician who may not edit any article may not
 * edit this one either.
 */
export async function canMutateKnowledgeBaseArticles(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: SubjectUserInput & { seat_reader?: boolean | null },
  action: 'create' | 'update' | 'delete',
  requestCache: AuthorizationRequestCache = new RequestLocalAuthorizationCache()
): Promise<boolean> {
  if (isKnownStaff(user)) return true;
  const tenantScope = await probeTenantAuthorizationScope(conn, tenant, requestCache);
  if (tenantScope.resolverSubjects === false) return true;

  const subject = await resolveAuthorizationSubject(conn, { tenant, user, requestCache });
  const kernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider({ relationshipRules: [] }),
    rbacEvaluator: async () => true,
  });
  const decision = await kernel.authorizeResource({
    subject,
    resource: { type: KNOWLEDGE_BASE_ARTICLE_RESOURCE, action },
    // An empty record: a rule that grants nothing for this action must still be asked, and it needs a record to refuse.
    record: {},
    requestCache,
    knex: conn,
  });
  return decision.allowed;
}
