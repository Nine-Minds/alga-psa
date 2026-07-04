// CE stub. The real implementation lives in
// ee/server/src/services/email/inboundReplyAcknowledgementDecider.ts and is
// loaded via the @ee alias in Enterprise Edition builds only.
type InboundReplyAckDecision = 'ACK' | 'NOT_ACK';

interface InboundReplyAckDeciderResult {
  decision: InboundReplyAckDecision;
  source: 'default' | 'ee_ai';
  attempted: boolean;
  reason: 'ee_module_unavailable';
  model?: string | null;
  rawOutput?: string | null;
  error?: string | null;
}

interface InboundReplyAcknowledgementDecider {
  decide(): Promise<InboundReplyAckDeciderResult>;
}

export function createInboundReplyAcknowledgementDecider(): InboundReplyAcknowledgementDecider {
  return {
    async decide() {
      return {
        decision: 'NOT_ACK',
        source: 'ee_ai',
        attempted: false,
        reason: 'ee_module_unavailable',
        model: null,
        rawOutput: null,
        error: null,
      };
    },
  };
}
