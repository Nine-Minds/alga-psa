import type { AuthorizationReason } from '../kernel/contracts';
import { BUNDLE_CLOSED_BASELINE_DENIED_CODE, BUNDLE_PORTFOLIO_DENIED_CODE } from '../kernel/providers/bundleProvider';
import { PREREQUISITE_ACTION_DENIED_CODE } from '../kernel/engine';
import { CREATE_CANDIDATE_DENIED_CODE } from '../kernel/candidateRecord';
import { RESOLVER_CLOSED_BASELINE_DENIED_CODE } from '../kernel/providers/builtinResolverEvaluation';

/**
 * Maps the kernel's denial reason codes to a plain-language explanation. The simulator shows these instead of
 * the raw codes. Matching is on `reason.code` only; message strings are never parsed. The explanation carries an
 * i18n key (namespace `msp/admin`) and the parameters its sentence interpolates; the UI localizes it.
 */

export type DenialExplanationKind =
  | 'closed_baseline'
  | 'client_portfolio'
  | 'create_out_of_scope'
  | 'read_required'
  | 'other_denial';

export interface DenialExplanation {
  code: string;
  kind: DenialExplanationKind;
  messageKey: string;
  /** `resource` and `action`/`requiredAction` are kernel identifiers; the UI localizes their labels. */
  params: { resource?: string; action?: string; requiredAction?: string };
}

const KEY_PREFIX = 'policyManagement.simulator.explanations';

const EXPLANATIONS: Record<string, { kind: DenialExplanationKind; messageKey: string }> = {
  [BUNDLE_CLOSED_BASELINE_DENIED_CODE]: { kind: 'closed_baseline', messageKey: `${KEY_PREFIX}.closedBaseline` },
  [RESOLVER_CLOSED_BASELINE_DENIED_CODE]: { kind: 'closed_baseline', messageKey: `${KEY_PREFIX}.closedBaseline` },
  [BUNDLE_PORTFOLIO_DENIED_CODE]: { kind: 'client_portfolio', messageKey: `${KEY_PREFIX}.clientPortfolio` },
  [CREATE_CANDIDATE_DENIED_CODE]: { kind: 'create_out_of_scope', messageKey: `${KEY_PREFIX}.createOutOfScope` },
  [PREREQUISITE_ACTION_DENIED_CODE]: { kind: 'read_required', messageKey: `${KEY_PREFIX}.readRequired` },
};

/** Codes that explain a denial without being one of the four named kinds. Keyed like the table above. */
const OTHER_DENIALS: Record<string, string> = {
  bundle_template_denied: `${KEY_PREFIX}.templateDenied`,
  client_visible_only_denied: `${KEY_PREFIX}.clientVisibleOnly`,
  not_self_approver_denied: `${KEY_PREFIX}.notSelfApprover`,
  billing_not_self_approver_denied: `${KEY_PREFIX}.notSelfApprover`,
  bundle_rules_unavailable: `${KEY_PREFIX}.rulesUnavailable`,
  rbac_denied: `${KEY_PREFIX}.rbacDenied`,
  resolver_template_denied: `${KEY_PREFIX}.templateDenied`,
};

function metadataString(reason: AuthorizationReason, key: string): string | undefined {
  const value = reason.metadata?.[key];
  return typeof value === 'string' ? value : undefined;
}

export function explainDenialReason(reason: Pick<AuthorizationReason, 'code' | 'metadata'>): DenialExplanation | null {
  const full = reason as AuthorizationReason;
  const known = EXPLANATIONS[reason.code];
  const otherKey = OTHER_DENIALS[reason.code];
  if (!known && !otherKey) return null;
  return {
    code: reason.code,
    kind: known?.kind ?? 'other_denial',
    messageKey: known?.messageKey ?? otherKey,
    params: {
      resource: metadataString(full, 'resource'),
      action: metadataString(full, 'action'),
      requiredAction: metadataString(full, 'requiredAction'),
    },
  };
}

/** The explanations for a decision's reasons, one per distinct code, in the order the kernel emitted them. */
export function explainDenialReasons(
  reasons: ReadonlyArray<Pick<AuthorizationReason, 'code' | 'metadata'>>
): DenialExplanation[] {
  const seen = new Set<string>();
  const out: DenialExplanation[] = [];
  for (const reason of reasons) {
    const explanation = explainDenialReason(reason);
    if (!explanation || seen.has(explanation.code)) continue;
    seen.add(explanation.code);
    out.push(explanation);
  }
  return out;
}
