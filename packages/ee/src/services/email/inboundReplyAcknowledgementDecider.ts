import { createTenantKnex } from '@alga-psa/db';
import { ADD_ONS, tenantHasAddOn, type AddOnKey } from '@alga-psa/types';
import type {
  InboundReplyAcknowledgementDecider,
  InboundReplyAckDeciderInput,
  InboundReplyAckDeciderResult,
} from '@alga-psa/shared/services/email/inboundReplyAcknowledgementDecider';

import { resolveChatProvider } from '../chatProviderResolver';

const ACK_PROMPT = [
  'Classify this customer ticket reply.',
  'Return exactly one token: ACK or NOT_ACK.',
  'ACK only when it is a short acknowledgement with no request, no question, and no new work.',
  'Otherwise return NOT_ACK.',
].join(' ');

const ACK_CANDIDATE_MAX_CHARS = 280;
const ACK_CANDIDATE_MAX_WORDS = 40;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isAckCandidate(text: string): boolean {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) {
    return false;
  }

  const words = normalized.split(' ').filter(Boolean);
  if (normalized.length > ACK_CANDIDATE_MAX_CHARS || words.length > ACK_CANDIDATE_MAX_WORDS) {
    return false;
  }

  if (normalized.includes('?')) {
    return false;
  }

  const cuePatterns = [
    /\bthanks?\b/,
    /\bthank you\b/,
    /\bgot it\b/,
    /\blooks good\b/,
    /\bok(ay)?\b/,
    /\bperfect\b/,
    /\bappreciate\b/,
    /\bresolved\b/,
  ];

  return cuePatterns.some((pattern) => pattern.test(normalized));
}

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

function parseAckDecision(raw: unknown): 'ACK' | 'NOT_ACK' | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const normalized = raw.trim().toUpperCase();
  if (normalized === 'ACK' || normalized === 'NOT_ACK') {
    return normalized;
  }

  return null;
}

const eeDecider: InboundReplyAcknowledgementDecider = {
  async decide(input: InboundReplyAckDeciderInput): Promise<InboundReplyAckDeciderResult> {
    const normalizedText = normalizeText(input.text);
    if (!isAckCandidate(normalizedText)) {
      return {
        decision: 'NOT_ACK',
        source: 'ee_ai',
        attempted: false,
        reason: 'message_not_candidate',
        model: null,
        rawOutput: null,
        error: null,
      };
    }

    const hasAiAssistant = await tenantHasAiAssistantAddOn(input.tenantId);
    if (!hasAiAssistant) {
      return {
        decision: 'NOT_ACK',
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
          { role: 'system', content: ACK_PROMPT },
          {
            role: 'user',
            content: `Subject: ${input.subject ?? ''}\nReply: ${normalizedText}`,
          },
        ],
        temperature: 0,
        max_tokens: 8,
        ...provider.requestOverrides.resolveTurnOverrides(),
      });

      const rawOutput = completion.choices?.[0]?.message?.content ?? '';
      const decision = parseAckDecision(rawOutput);
      if (!decision) {
        return {
          decision: 'NOT_ACK',
          source: 'ee_ai',
          attempted: true,
          reason: 'ai_invalid_output',
          model: provider.model,
          rawOutput: typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput),
          error: 'AI returned an unexpected acknowledgement classification payload.',
        };
      }

      return {
        decision,
        source: 'ee_ai',
        attempted: true,
        reason: 'ai_classified',
        model: provider.model,
        rawOutput: typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput),
        error: null,
      };
    } catch (error) {
      return {
        decision: 'NOT_ACK',
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

export function createInboundReplyAcknowledgementDecider(): InboundReplyAcknowledgementDecider {
  return eeDecider;
}
