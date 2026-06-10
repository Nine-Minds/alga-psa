import { createTenantKnex } from '@alga-psa/db';
import { ADD_ONS, tenantHasAddOn, type AddOnKey } from '@alga-psa/types';

import { resolveChatProvider } from '../chatProviderResolver';

type InboundEmailAiDecision = 'skip' | 'assign_client' | 'no_decision';
type InboundEmailAiAllowedOutcome = 'skip' | 'assign_client';

interface InboundEmailAiClassifierInput {
  tenantId: string;
  providerId: string;
  ruleId: string;
  instruction: string;
  allowedOutcomes: InboundEmailAiAllowedOutcome[];
  subject?: string;
  fromAddress?: string;
  bodyExcerpt: string;
}

interface InboundEmailAiClassifierResult {
  decision: InboundEmailAiDecision;
  extractedClientName?: string | null;
  source: 'default' | 'ee_ai';
  attempted: boolean;
  reason:
    | 'default_non_ai'
    | 'ai_addon_missing'
    | 'ai_classified'
    | 'ai_failed'
    | 'ai_invalid_output'
    | 'ee_module_unavailable';
  model?: string | null;
  rawOutput?: string | null;
  error?: string | null;
}

interface InboundEmailAiClassifier {
  classify(input: InboundEmailAiClassifierInput): Promise<InboundEmailAiClassifierResult>;
}

const MAX_OUTPUT_TOKENS = 120;
const MAX_CLIENT_NAME_LENGTH = 200;

async function tenantHasAiAssistantAddOn(tenantId: string): Promise<boolean> {
  const { knex } = await createTenantKnex(tenantId);
  try {
    const rows = await knex('tenant_addons')
      .select('addon_key', 'expires_at')
      .where({ tenant: tenantId }) as Array<{ addon_key: string; expires_at: string | Date | null }>;

    const now = Date.now();
    const knownAddOns = new Set<string>(Object.values(ADD_ONS));
    const active = rows
      .filter((row) => !row.expires_at || new Date(row.expires_at).getTime() > now)
      .map((row) => row.addon_key)
      .filter((value): value is AddOnKey => knownAddOns.has(value));

    return tenantHasAddOn(active, ADD_ONS.AI_ASSISTANT);
  } catch {
    return false;
  }
}

function buildSystemPrompt(allowedOutcomes: InboundEmailAiAllowedOutcome[]): string {
  const outcomeDescriptions: string[] = [];
  if (allowedOutcomes.includes('skip')) {
    outcomeDescriptions.push(
      '"skip" when the email should not create a ticket at all (pure notification/status noise)'
    );
  }
  if (allowedOutcomes.includes('assign_client')) {
    outcomeDescriptions.push(
      '"assign_client" when the email is about an identifiable customer/client; put that customer name in client_name exactly as written in the email'
    );
  }

  return [
    'You classify an inbound email for an MSP ticketing system, following the operator instruction.',
    `Allowed decisions: ${outcomeDescriptions.join('; ')}; "no_decision" when neither applies or you are unsure.`,
    'Never guess a customer name that is not present in the email.',
    'Respond with ONLY a JSON object: {"decision": "skip" | "assign_client" | "no_decision", "client_name": string | null}.',
  ].join(' ');
}

function parseClassifierOutput(raw: unknown): {
  decision: InboundEmailAiDecision;
  clientName: string | null;
} | null {
  if (typeof raw !== 'string' || !raw.trim()) {
    return null;
  }

  // Tolerate fenced or prefixed output by extracting the first JSON object.
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const decisionRaw = (parsed as Record<string, unknown>).decision;
  const decision =
    decisionRaw === 'skip' || decisionRaw === 'assign_client' || decisionRaw === 'no_decision'
      ? decisionRaw
      : null;
  if (!decision) {
    return null;
  }

  const clientNameRaw = (parsed as Record<string, unknown>).client_name;
  const clientName =
    typeof clientNameRaw === 'string' && clientNameRaw.trim()
      ? clientNameRaw.trim().slice(0, MAX_CLIENT_NAME_LENGTH)
      : null;

  return { decision, clientName };
}

const eeClassifier: InboundEmailAiClassifier = {
  async classify(input: InboundEmailAiClassifierInput): Promise<InboundEmailAiClassifierResult> {
    const hasAiAssistant = await tenantHasAiAssistantAddOn(input.tenantId);
    if (!hasAiAssistant) {
      return {
        decision: 'no_decision',
        source: 'ee_ai',
        attempted: false,
        reason: 'ai_addon_missing',
        model: null,
        rawOutput: null,
        error: null,
      };
    }

    try {
      const provider = await resolveChatProvider();
      const completion = await provider.client.chat.completions.create({
        model: provider.model,
        messages: [
          { role: 'system', content: buildSystemPrompt(input.allowedOutcomes) },
          {
            role: 'user',
            content: [
              `Operator instruction: ${input.instruction}`,
              `From: ${input.fromAddress ?? ''}`,
              `Subject: ${input.subject ?? ''}`,
              `Body excerpt:\n${input.bodyExcerpt}`,
            ].join('\n'),
          },
        ],
        temperature: 0,
        max_tokens: MAX_OUTPUT_TOKENS,
        ...provider.requestOverrides.resolveTurnOverrides(),
      });

      // Structured usage line so per-tenant token metering can be layered on
      // without changing this module.
      const usage = (completion as { usage?: Record<string, unknown> }).usage;
      if (usage) {
        console.info('inboundEmailRuleAiClassifier: token usage', {
          tenantId: input.tenantId,
          providerId: input.providerId,
          ruleId: input.ruleId,
          model: provider.model,
          usage,
        });
      }

      const rawOutput = completion.choices?.[0]?.message?.content ?? '';
      const parsed = parseClassifierOutput(rawOutput);
      if (!parsed) {
        return {
          decision: 'no_decision',
          source: 'ee_ai',
          attempted: true,
          reason: 'ai_invalid_output',
          model: provider.model,
          rawOutput: typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput),
          error: 'AI returned an unexpected inbound email classification payload.',
        };
      }

      const decision =
        parsed.decision !== 'no_decision' && !input.allowedOutcomes.includes(parsed.decision)
          ? 'no_decision'
          : parsed.decision;

      return {
        decision,
        extractedClientName: decision === 'assign_client' ? parsed.clientName : null,
        source: 'ee_ai',
        attempted: true,
        reason: 'ai_classified',
        model: provider.model,
        rawOutput: typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput),
        error: null,
      };
    } catch (error) {
      return {
        decision: 'no_decision',
        source: 'ee_ai',
        attempted: true,
        reason: 'ai_failed',
        model: null,
        rawOutput: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export function createInboundEmailRuleAiClassifier(): InboundEmailAiClassifier {
  return eeClassifier;
}
