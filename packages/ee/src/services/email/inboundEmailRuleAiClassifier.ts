// CE stub. The real implementation lives in
// ee/server/src/services/email/inboundEmailRuleAiClassifier.ts and is loaded
// via the @ee alias in Enterprise Edition builds only.
type InboundEmailAiDecision = 'skip' | 'assign_client' | 'no_decision';

interface InboundEmailAiClassifierResult {
  decision: InboundEmailAiDecision;
  extractedClientName?: string | null;
  source: 'default' | 'ee_ai';
  attempted: boolean;
  reason: 'ee_module_unavailable';
  model?: string | null;
  rawOutput?: string | null;
  error?: string | null;
}

interface InboundEmailAiClassifier {
  classify(): Promise<InboundEmailAiClassifierResult>;
}

export function createInboundEmailRuleAiClassifier(): InboundEmailAiClassifier {
  return {
    async classify() {
      return {
        decision: 'no_decision',
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
