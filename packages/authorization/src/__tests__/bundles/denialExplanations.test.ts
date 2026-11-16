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
  describe('a built-in resolver\'s relationship-template denial', () => {
    const denied = (templateKeys?: string[]) => ({ code: 'resolver_template_denied', metadata: { resource: 'ticket', action: 'read', ...(templateKeys ? { templateKeys } : {}) } });

    it('names the board scope when the record failed a selected-boards template', () => {
      expect(explainDenialReason(denied(['selected_boards']))).toMatchObject({
        kind: 'resolver_board_scope', messageKey: 'policyManagement.simulator.explanations.resolverBoardScope', params: { resource: 'ticket', action: 'read' },
      });
    });

    it('names the client when the record failed a selected-clients template', () => {
      expect(explainDenialReason(denied(['selected_clients']))).toMatchObject({ kind: 'resolver_client_scope', messageKey: 'policyManagement.simulator.explanations.resolverClientScope' });
    });

    it('falls back to the general built-in rule message when no scope is named', () => {
      expect(explainDenialReason(denied())).toMatchObject({ kind: 'other_denial', messageKey: 'policyManagement.simulator.explanations.resolverTemplateDenied' });
      expect(explainDenialReason(denied(['selected_records']))).toMatchObject({ kind: 'other_denial' });
    });

    it('decides from the templates the resolver reported, not from rule ids', () => {
      const reason = { code: 'resolver_template_denied', metadata: { ruleIds: ['seat:ticket:read:in_scope_board'], templateKeys: ['selected_clients'] } };
      expect(explainDenialReason(reason)).toMatchObject({ kind: 'resolver_client_scope' });
    });
  });
});
