/**
 * Inbound email rules engine: loads a tenant's ordered rules, evaluates them
 * against one email, and returns a terminal outcome for the pipeline.
 *
 * Walk semantics: the first rule whose conditions all match executes its
 * action. A resolved action stops the walk. When the action's extraction or
 * classification fails to produce a client, on_no_match decides: 'proceed'
 * continues down the list (enabling "regex rule first, AI catch-all later"),
 * 'skip' and 'fallback_destination' stop with that outcome.
 *
 * Any unexpected engine error degrades to { kind: 'none' } so a misconfigured
 * rule can never block email processing.
 */

import type { Knex } from 'knex';
import {
  buildRuleEmailInput,
  evaluateConditions,
  extractValue,
  normalizeExtractedValue,
} from './evaluator';
import { resolveInboundEmailAiClassifier } from './aiClassifier';
import type {
  AiClassifyActionConfig,
  ExtractAssignClientActionConfig,
  InboundEmailClientMatch,
  InboundEmailRule,
  InboundEmailRuleEmailInput,
  InboundEmailRuleEvaluation,
  InboundEmailRuleOutcome,
  InboundEmailRuleTraceEntry,
  SetDestinationActionConfig,
} from './types';

const AI_BODY_EXCERPT_LENGTH = 4_000;

export interface InboundEmailRuleEngineDeps {
  loadRules(tenantId: string): Promise<InboundEmailRule[]>;
  matchClientByName(tenantId: string, normalizedName: string): Promise<InboundEmailClientMatch | null>;
  resolveDefaultsById(tenantId: string, defaultsId: string): Promise<Record<string, unknown> | null>;
  classifyWithAi(input: {
    tenantId: string;
    providerId: string;
    ruleId: string;
    config: AiClassifyActionConfig;
    email: InboundEmailRuleEmailInput;
  }): Promise<{ decision: 'skip' | 'assign_client' | 'no_decision'; extractedClientName?: string | null }>;
}

function parseJsonbArray(value: unknown): string[] | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((entry): entry is string => typeof entry === 'string')
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

function parseJsonbObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function parseConditions(value: unknown): InboundEmailRule['conditions'] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? safeJsonParse(value) : null;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is InboundEmailRule['conditions'][number] =>
      Boolean(entry) &&
      typeof entry === 'object' &&
      typeof (entry as any).field === 'string' &&
      typeof (entry as any).operator === 'string' &&
      typeof (entry as any).value === 'string'
  );
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function mapRuleRow(row: Record<string, unknown>): InboundEmailRule {
  return {
    tenant: String(row.tenant),
    id: String(row.id),
    name: typeof row.name === 'string' ? row.name : '',
    is_active: Boolean(row.is_active),
    position: Number(row.position) || 0,
    provider_ids: parseJsonbArray(row.provider_ids),
    conditions: parseConditions(row.conditions),
    action_type: row.action_type as InboundEmailRule['action_type'],
    action_config: parseJsonbObject(row.action_config),
    on_no_match: (row.on_no_match as InboundEmailRule['on_no_match']) ?? 'proceed',
    fallback_inbound_ticket_defaults_id:
      typeof row.fallback_inbound_ticket_defaults_id === 'string'
        ? row.fallback_inbound_ticket_defaults_id
        : null,
  };
}

const INBOUND_DEFAULTS_SELECT_COLUMNS = [
  'board_id',
  'status_id',
  'priority_id',
  'client_id',
  'entered_by',
  'category_id',
  'subcategory_id',
  'location_id',
] as const;

function createDefaultDeps(): InboundEmailRuleEngineDeps {
  return {
    async loadRules(tenantId) {
      const { withAdminTransaction } = await import('@alga-psa/db');
      return withAdminTransaction(async (trx: Knex.Transaction) => {
        try {
          const rows = await trx('inbound_email_rules')
            .where({ tenant: tenantId, is_active: true })
            .orderBy('position', 'asc')
            .orderBy('id', 'asc');
          return rows.map((row: Record<string, unknown>) => mapRuleRow(row));
        } catch (error: any) {
          // Environments that haven't run the migration yet: behave as "no rules".
          const message = String(error?.message ?? '');
          if (message.includes('inbound_email_rules') && message.includes('does not exist')) {
            return [];
          }
          throw error;
        }
      });
    },

    async matchClientByName(tenantId, normalizedName) {
      if (!normalizedName) return null;
      const { withAdminTransaction } = await import('@alga-psa/db');
      return withAdminTransaction(async (trx: Knex.Transaction) => {
        const activeClients = (builder: Knex.QueryBuilder) =>
          builder.where(function (this: Knex.QueryBuilder) {
            this.where('clients.is_inactive', false).orWhereNull('clients.is_inactive');
          });

        const byName = await activeClients(
          trx('clients')
            .select('client_id')
            .where('tenant', tenantId)
            .andWhereRaw('lower(regexp_replace(trim(client_name), \'\\s+\', \' \', \'g\')) = ?', [normalizedName])
        ).first();

        if ((byName as any)?.client_id) {
          return { clientId: (byName as any).client_id, matchedBy: 'client_name' as const };
        }

        const byAlias = await activeClients(
          trx('client_name_aliases')
            .select('client_name_aliases.client_id')
            .join('clients', function (this: Knex.JoinClause) {
              this.on('clients.client_id', 'client_name_aliases.client_id').andOn(
                'clients.tenant',
                'client_name_aliases.tenant'
              );
            })
            .where('client_name_aliases.tenant', tenantId)
            .andWhereRaw('lower(regexp_replace(trim(client_name_aliases.alias), \'\\s+\', \' \', \'g\')) = ?', [
              normalizedName,
            ])
        ).first();

        return (byAlias as any)?.client_id
          ? { clientId: (byAlias as any).client_id, matchedBy: 'alias' as const }
          : null;
      });
    },

    async resolveDefaultsById(tenantId, defaultsId) {
      if (!defaultsId) return null;
      const { withAdminTransaction } = await import('@alga-psa/db');
      return withAdminTransaction(async (trx: Knex.Transaction) => {
        const row = await trx('inbound_ticket_defaults')
          .where({ tenant: tenantId, id: defaultsId, is_active: true })
          .select(...INBOUND_DEFAULTS_SELECT_COLUMNS)
          .first();
        return row ?? null;
      });
    },

    async classifyWithAi({ tenantId, providerId, ruleId, config, email }) {
      const classifier = await resolveInboundEmailAiClassifier();
      const result = await classifier.classify({
        tenantId,
        providerId,
        ruleId,
        instruction: config.instruction,
        allowedOutcomes: config.allowed_outcomes,
        subject: email.subject,
        fromAddress: email.fromAddress,
        bodyExcerpt: email.bodyText.slice(0, AI_BODY_EXCERPT_LENGTH),
      });
      return {
        decision: result.decision,
        extractedClientName: result.extractedClientName ?? null,
      };
    },
  };
}

function isExtractAssignConfig(config: Record<string, unknown>): config is Record<string, unknown> & ExtractAssignClientActionConfig {
  const extraction = (config as any)?.extraction;
  return (
    Boolean(extraction) &&
    typeof extraction === 'object' &&
    typeof extraction.type === 'string' &&
    ((config as any).source === 'subject' || (config as any).source === 'body_text')
  );
}

function isAiClassifyConfig(config: Record<string, unknown>): config is Record<string, unknown> & AiClassifyActionConfig {
  return typeof (config as any)?.instruction === 'string' && Array.isArray((config as any)?.allowed_outcomes);
}

export interface EvaluateInboundEmailRulesParams {
  tenantId: string;
  providerId: string;
  emailData: {
    id?: string;
    from?: { email?: string };
    to?: Array<{ email?: string }>;
    cc?: Array<{ email?: string }>;
    subject?: string;
    body?: { text?: string; html?: string };
  };
  deps?: Partial<InboundEmailRuleEngineDeps>;
}

export async function evaluateInboundEmailRules(
  params: EvaluateInboundEmailRulesParams
): Promise<InboundEmailRuleEvaluation> {
  const trace: InboundEmailRuleTraceEntry[] = [];

  try {
    const deps: InboundEmailRuleEngineDeps = { ...createDefaultDeps(), ...params.deps };
    const rules = await deps.loadRules(params.tenantId);
    if (!rules.length) {
      return { outcome: { kind: 'none' }, trace };
    }

    const email = buildRuleEmailInput(params.emailData);

    for (const rule of rules) {
      if (rule.provider_ids && !rule.provider_ids.includes(params.providerId)) {
        trace.push({
          ruleId: rule.id,
          ruleName: rule.name,
          conditionsMatched: false,
          conditionResults: [],
          resolution: 'provider_filtered',
        });
        continue;
      }

      const { matched, results } = evaluateConditions(rule.conditions, email);
      if (!matched) {
        trace.push({
          ruleId: rule.id,
          ruleName: rule.name,
          conditionsMatched: false,
          conditionResults: results,
          resolution: 'conditions_not_matched',
        });
        continue;
      }

      const resolution = await executeRuleAction({ rule, email, deps, params, trace: results });
      trace.push(resolution.traceEntry);

      if (resolution.outcome) {
        return { outcome: resolution.outcome, trace };
      }
      // Falls through to the next rule (on_no_match = proceed or dangling reference).
    }

    return { outcome: { kind: 'none' }, trace };
  } catch (error) {
    console.warn('inboundEmailRules: engine error; falling through to unmodified pipeline', {
      tenantId: params.tenantId,
      providerId: params.providerId,
      emailId: params.emailData?.id,
      error: error instanceof Error ? error.message : String(error),
    });
    trace.push({
      ruleId: '',
      ruleName: '',
      conditionsMatched: false,
      conditionResults: [],
      resolution: 'error',
      detail: error instanceof Error ? error.message : String(error),
    });
    return { outcome: { kind: 'none' }, trace };
  }
}

async function executeRuleAction(args: {
  rule: InboundEmailRule;
  email: InboundEmailRuleEmailInput;
  deps: InboundEmailRuleEngineDeps;
  params: EvaluateInboundEmailRulesParams;
  trace: InboundEmailRuleTraceEntry['conditionResults'];
}): Promise<{ outcome: InboundEmailRuleOutcome | null; traceEntry: InboundEmailRuleTraceEntry }> {
  const { rule, email, deps, params } = args;
  const base: InboundEmailRuleTraceEntry = {
    ruleId: rule.id,
    ruleName: rule.name,
    conditionsMatched: true,
    conditionResults: args.trace,
    resolution: 'action_resolved',
  };

  switch (rule.action_type) {
    case 'skip':
      return {
        outcome: { kind: 'skip', ruleId: rule.id, ruleName: rule.name, via: 'action' },
        traceEntry: base,
      };

    case 'set_destination': {
      const defaultsId = (rule.action_config as Partial<SetDestinationActionConfig>)
        .inbound_ticket_defaults_id;
      const defaults =
        typeof defaultsId === 'string' && defaultsId
          ? await deps.resolveDefaultsById(params.tenantId, defaultsId)
          : null;

      if (!defaults) {
        console.warn('inboundEmailRules: set_destination references missing/inactive defaults; continuing', {
          tenantId: params.tenantId,
          ruleId: rule.id,
          defaultsId: defaultsId ?? null,
        });
        return {
          outcome: null,
          traceEntry: { ...base, resolution: 'dangling_reference', detail: 'set_destination defaults missing' },
        };
      }

      return {
        outcome: { kind: 'set_destination', ruleId: rule.id, ruleName: rule.name, defaults },
        traceEntry: base,
      };
    }

    case 'extract_assign_client': {
      if (!isExtractAssignConfig(rule.action_config)) {
        console.warn('inboundEmailRules: malformed extract_assign_client config; continuing', {
          tenantId: params.tenantId,
          ruleId: rule.id,
        });
        return {
          outcome: null,
          traceEntry: { ...base, resolution: 'dangling_reference', detail: 'malformed action_config' },
        };
      }

      const rawValue = extractValue(rule.action_config, email);
      const normalized = normalizeExtractedValue(rawValue);
      base.extractedValue = rawValue;

      if (normalized) {
        const match = await deps.matchClientByName(params.tenantId, normalized);
        base.clientMatch = match;
        if (match) {
          return {
            outcome: {
              kind: 'assign_client',
              ruleId: rule.id,
              ruleName: rule.name,
              clientId: match.clientId,
              extractedValue: normalized,
              matchSource: 'rule_extraction',
            },
            traceEntry: base,
          };
        }
      }

      return resolveNoMatch({ rule, deps, params, base });
    }

    case 'ai_classify': {
      if (!isAiClassifyConfig(rule.action_config)) {
        console.warn('inboundEmailRules: malformed ai_classify config; continuing', {
          tenantId: params.tenantId,
          ruleId: rule.id,
        });
        return {
          outcome: null,
          traceEntry: { ...base, resolution: 'dangling_reference', detail: 'malformed action_config' },
        };
      }

      const config = rule.action_config;
      let decision: { decision: 'skip' | 'assign_client' | 'no_decision'; extractedClientName?: string | null };
      try {
        decision = await deps.classifyWithAi({
          tenantId: params.tenantId,
          providerId: params.providerId,
          ruleId: rule.id,
          config,
          email,
        });
      } catch (error) {
        console.warn('inboundEmailRules: ai_classify failed; treating as non-match', {
          tenantId: params.tenantId,
          ruleId: rule.id,
          error: error instanceof Error ? error.message : String(error),
        });
        decision = { decision: 'no_decision' };
      }

      // Decisions outside the rule's allowed outcomes are ignored.
      if (decision.decision !== 'no_decision' && !config.allowed_outcomes.includes(decision.decision)) {
        decision = { decision: 'no_decision' };
      }
      base.aiDecision = decision.decision;

      if (decision.decision === 'skip') {
        return {
          outcome: { kind: 'skip', ruleId: rule.id, ruleName: rule.name, via: 'action' },
          traceEntry: base,
        };
      }

      if (decision.decision === 'assign_client') {
        const normalized = normalizeExtractedValue(decision.extractedClientName);
        base.extractedValue = decision.extractedClientName ?? null;
        if (normalized) {
          const match = await deps.matchClientByName(params.tenantId, normalized);
          base.clientMatch = match;
          if (match) {
            return {
              outcome: {
                kind: 'assign_client',
                ruleId: rule.id,
                ruleName: rule.name,
                clientId: match.clientId,
                extractedValue: normalized,
                matchSource: 'rule_ai',
              },
              traceEntry: base,
            };
          }
        }
      }

      return resolveNoMatch({ rule, deps, params, base });
    }

    default:
      console.warn('inboundEmailRules: unknown action_type; continuing', {
        tenantId: params.tenantId,
        ruleId: rule.id,
        actionType: rule.action_type,
      });
      return {
        outcome: null,
        traceEntry: { ...base, resolution: 'dangling_reference', detail: `unknown action_type ${rule.action_type}` },
      };
  }
}

async function resolveNoMatch(args: {
  rule: InboundEmailRule;
  deps: InboundEmailRuleEngineDeps;
  params: EvaluateInboundEmailRulesParams;
  base: InboundEmailRuleTraceEntry;
}): Promise<{ outcome: InboundEmailRuleOutcome | null; traceEntry: InboundEmailRuleTraceEntry }> {
  const { rule, deps, params, base } = args;

  switch (rule.on_no_match) {
    case 'skip':
      return {
        outcome: { kind: 'skip', ruleId: rule.id, ruleName: rule.name, via: 'on_no_match' },
        traceEntry: { ...base, resolution: 'no_match_skip' },
      };

    case 'fallback_destination': {
      const defaults = rule.fallback_inbound_ticket_defaults_id
        ? await deps.resolveDefaultsById(params.tenantId, rule.fallback_inbound_ticket_defaults_id)
        : null;

      if (!defaults) {
        console.warn('inboundEmailRules: fallback destination missing/inactive; continuing', {
          tenantId: params.tenantId,
          ruleId: rule.id,
          defaultsId: rule.fallback_inbound_ticket_defaults_id,
        });
        return {
          outcome: null,
          traceEntry: { ...base, resolution: 'dangling_reference', detail: 'fallback defaults missing' },
        };
      }

      return {
        outcome: { kind: 'fallback_destination', ruleId: rule.id, ruleName: rule.name, defaults },
        traceEntry: { ...base, resolution: 'no_match_fallback' },
      };
    }

    case 'proceed':
    default:
      return {
        outcome: null,
        traceEntry: { ...base, resolution: 'no_match_proceed' },
      };
  }
}
