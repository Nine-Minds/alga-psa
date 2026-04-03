import { isEnterprise } from '@alga-psa/core/features';

export type InboundReplyAckDecision = 'ACK' | 'NOT_ACK';

export interface InboundReplyAckDeciderInput {
  tenantId: string;
  boardId: string;
  ticketId: string;
  subject?: string;
  text: string;
}

export interface InboundReplyAckDeciderResult {
  decision: InboundReplyAckDecision;
  source: 'default' | 'ee_ai';
  attempted: boolean;
  reason:
    | 'default_non_ai'
    | 'board_suppression_disabled'
    | 'ai_addon_missing'
    | 'message_not_candidate'
    | 'ai_classified'
    | 'ai_failed'
    | 'ai_invalid_output'
    | 'ee_module_unavailable';
  model?: string | null;
  rawOutput?: string | null;
  error?: string | null;
}

export interface InboundReplyAcknowledgementDecider {
  decide(input: InboundReplyAckDeciderInput): Promise<InboundReplyAckDeciderResult>;
}

const defaultDecider: InboundReplyAcknowledgementDecider = {
  async decide() {
    return {
      decision: 'NOT_ACK',
      source: 'default',
      attempted: false,
      reason: 'default_non_ai',
      model: null,
      rawOutput: null,
      error: null,
    };
  },
};

let eeDeciderLoadAttempted = false;
let eeDecider: InboundReplyAcknowledgementDecider | null = null;

async function loadEeDecider(): Promise<InboundReplyAcknowledgementDecider | null> {
  if (eeDeciderLoadAttempted) {
    return eeDecider;
  }

  eeDeciderLoadAttempted = true;
  try {
    const module = await import('@ee/services/email/inboundReplyAcknowledgementDecider');
    if (module && typeof module.createInboundReplyAcknowledgementDecider === 'function') {
      eeDecider = module.createInboundReplyAcknowledgementDecider();
    }
  } catch {
    eeDecider = null;
  }

  return eeDecider;
}

export async function resolveInboundReplyAcknowledgementDecider(): Promise<InboundReplyAcknowledgementDecider> {
  if (!isEnterprise) {
    return defaultDecider;
  }

  const resolvedEeDecider = await loadEeDecider();
  return resolvedEeDecider ?? defaultDecider;
}
