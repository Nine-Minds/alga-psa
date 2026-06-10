export type InboundEmailRuleConditionField =
  | 'from_address'
  | 'from_domain'
  | 'to_address'
  | 'subject'
  | 'body_text';

export type InboundEmailRuleConditionOperator =
  | 'equals'
  | 'contains'
  | 'starts_with'
  | 'ends_with'
  | 'matches_regex';

export interface InboundEmailRuleCondition {
  field: InboundEmailRuleConditionField;
  operator: InboundEmailRuleConditionOperator;
  value: string;
}

export type InboundEmailRuleActionType =
  | 'skip'
  | 'extract_assign_client'
  | 'set_destination'
  | 'ai_classify';

export type InboundEmailRuleOnNoMatch = 'proceed' | 'fallback_destination' | 'skip';

export type InboundEmailExtractionSource = 'subject' | 'body_text';

export type InboundEmailExtraction =
  | { type: 'between'; start: string; end: string; occurrence?: 'first' | 'last' }
  | { type: 'after'; marker: string; occurrence?: 'first' | 'last' }
  | { type: 'before'; marker: string; occurrence?: 'first' | 'last' }
  | { type: 'regex'; pattern: string };

export interface ExtractAssignClientActionConfig {
  source: InboundEmailExtractionSource;
  extraction: InboundEmailExtraction;
}

export interface SetDestinationActionConfig {
  inbound_ticket_defaults_id: string;
}

export type InboundEmailAiAllowedOutcome = 'skip' | 'assign_client';

export interface AiClassifyActionConfig {
  instruction: string;
  allowed_outcomes: InboundEmailAiAllowedOutcome[];
}

export interface InboundEmailRule {
  tenant: string;
  id: string;
  name: string;
  is_active: boolean;
  position: number;
  provider_ids: string[] | null;
  conditions: InboundEmailRuleCondition[];
  action_type: InboundEmailRuleActionType;
  action_config: Record<string, unknown>;
  on_no_match: InboundEmailRuleOnNoMatch;
  fallback_inbound_ticket_defaults_id: string | null;
}

/** Email fields the evaluator matches against, derived from EmailMessageDetails. */
export interface InboundEmailRuleEmailInput {
  fromAddress: string;
  fromDomain: string;
  toAddresses: string[];
  subject: string;
  bodyText: string;
}

export interface InboundEmailRuleConditionResult {
  condition: InboundEmailRuleCondition;
  passed: boolean;
}

export type InboundEmailClientMatchSource = 'client_name' | 'alias';

export interface InboundEmailClientMatch {
  clientId: string;
  matchedBy: InboundEmailClientMatchSource;
}

/**
 * Terminal outcome of evaluating the tenant's rule list against one email.
 * `none` means no rule matched (or every matched rule fell through with
 * on_no_match=proceed) — the pipeline behaves exactly as if no rules existed.
 */
export type InboundEmailRuleOutcome =
  | { kind: 'none' }
  | { kind: 'skip'; ruleId: string; ruleName: string; via: 'action' | 'on_no_match' }
  | {
      kind: 'assign_client';
      ruleId: string;
      ruleName: string;
      clientId: string;
      extractedValue: string;
      matchSource: 'rule_extraction' | 'rule_ai';
    }
  | {
      kind: 'set_destination';
      ruleId: string;
      ruleName: string;
      defaults: Record<string, unknown>;
    }
  | {
      kind: 'fallback_destination';
      ruleId: string;
      ruleName: string;
      defaults: Record<string, unknown>;
    };

/** Per-rule trace entry, powering the structured log line and the UI tester. */
export interface InboundEmailRuleTraceEntry {
  ruleId: string;
  ruleName: string;
  conditionsMatched: boolean;
  conditionResults: InboundEmailRuleConditionResult[];
  extractedValue?: string | null;
  clientMatch?: InboundEmailClientMatch | null;
  aiDecision?: string | null;
  resolution:
    | 'conditions_not_matched'
    | 'provider_filtered'
    | 'action_resolved'
    | 'no_match_proceed'
    | 'no_match_skip'
    | 'no_match_fallback'
    | 'dangling_reference'
    | 'error';
  detail?: string;
}

export interface InboundEmailRuleEvaluation {
  outcome: InboundEmailRuleOutcome;
  trace: InboundEmailRuleTraceEntry[];
}
