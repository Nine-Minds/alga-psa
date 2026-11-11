import type { AuthorizationEvaluationInput, AuthorizationReason } from './contracts';

/** Emitted (stage 'mutation') when `create` is refused for the candidate record. */
export const CREATE_CANDIDATE_DENIED_CODE = 'create_candidate_denied';

/** The relationship templates that decide by the record's owning client. */
export const CLIENT_SCOPE_TEMPLATES: ReadonlySet<string> = new Set(['same_client', 'client_portfolio', 'selected_clients']);

/**
 * `create` is evaluated against the record about to be written, not against a stored row: there is no id
 * and the caller supplies the candidate's attributes (above all its owning client) in `record`.
 *
 * A create with no candidate at all is evaluated against an empty one. Client templates then have no client
 * to match, so a narrowed subject fails closed, while a subject no rule narrows is unaffected. Other actions
 * are returned untouched.
 */
export function withCandidateRecord(input: AuthorizationEvaluationInput): AuthorizationEvaluationInput {
  if (input.resource.action !== 'create' || input.record !== undefined) return input;
  return { ...input, record: {} };
}

interface InheritableRule {
  resource: string;
  action: string;
  templateKey?: string | null;
  constraintKey?: string | null;
  constraints?: unknown[];
  redactedFields?: string[];
}

/**
 * The part of the subject's READ rules that also decides a create: the client-scope templates. A candidate
 * record of a client the subject may not read is a record the subject may not create, so the bundle, portfolio
 * and resolver read rules that fence clients fence creation too, with the same denial codes. Everything else a
 * read rule says (ownership, boards, redaction, guards) concerns an existing row and is left out. They apply
 * in addition to any rule written for `create` itself. Empty for every action other than `create`.
 */
export function clientScopeReadRulesForCreate<T extends InheritableRule>(rules: T[], resource: string, action: string): T[] {
  if (action !== 'create') return [];
  return rules
    .filter((rule) => rule.resource === resource && rule.action === 'read' && CLIENT_SCOPE_TEMPLATES.has(rule.templateKey ?? ''))
    .map((rule) => ({ ...rule, constraintKey: null, constraints: [], redactedFields: [] }));
}

export function createCandidateDeniedReason(input: AuthorizationEvaluationInput): AuthorizationReason {
  return {
    stage: 'mutation',
    sourceType: 'system',
    code: CREATE_CANDIDATE_DENIED_CODE,
    message: "The subject's rules do not allow creating this record (its client is outside the subject's scope).",
    metadata: {
      resource: input.resource.type,
      action: input.resource.action,
      clientId: input.record?.clientId ?? null,
    },
  };
}
