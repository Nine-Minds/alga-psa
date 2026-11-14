import { describe, expect, it } from 'vitest';
import { explainDenialReason, explainDenialReasons } from '../../bundles/denialExplanations';
import {
  BUNDLE_CLOSED_BASELINE_DENIED_CODE,
  BUNDLE_PORTFOLIO_DENIED_CODE,
  CREATE_CANDIDATE_DENIED_CODE,
  PREREQUISITE_ACTION_DENIED_CODE,
} from '../../kernel';

describe('denial reason explanations', () => {
  it.each([
    [BUNDLE_CLOSED_BASELINE_DENIED_CODE, 'closed_baseline', 'policyManagement.simulator.explanations.closedBaseline'],
    [BUNDLE_PORTFOLIO_DENIED_CODE, 'client_portfolio', 'policyManagement.simulator.explanations.clientPortfolio'],
    [CREATE_CANDIDATE_DENIED_CODE, 'create_out_of_scope', 'policyManagement.simulator.explanations.createOutOfScope'],
    [PREREQUISITE_ACTION_DENIED_CODE, 'read_required', 'policyManagement.simulator.explanations.readRequired'],
  ])('maps %s by code', (code, kind, messageKey) => {
    expect(explainDenialReason({ code })).toMatchObject({ code, kind, messageKey });
  });

  it('decides on the code, never on the message text', () => {
    expect(explainDenialReason({ code: 'something_else', message: 'Closed bundle does not name this' } as any)).toBeNull();
  });

  it('carries resource, action and required action from the reason metadata', () => {
    expect(
      explainDenialReason({ code: PREREQUISITE_ACTION_DENIED_CODE, metadata: { resource: 'ticket', action: 'delete', requiredAction: 'read' } }).params
    ).toEqual({ resource: 'ticket', action: 'delete', requiredAction: 'read' });
  });

  it('skips allow reasons and de-duplicates codes in emitted order', () => {
    const out = explainDenialReasons([
      { code: 'rbac_allowed' },
      { code: BUNDLE_PORTFOLIO_DENIED_CODE },
      { code: CREATE_CANDIDATE_DENIED_CODE },
      { code: BUNDLE_PORTFOLIO_DENIED_CODE },
    ]);
    expect(out.map((e) => e.kind)).toEqual(['client_portfolio', 'create_out_of_scope']);
  });
});
