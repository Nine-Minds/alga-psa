import { isEnterprise } from '@alga-psa/core/features';
import type { AiClassifyActionConfig } from './types';

export type InboundEmailAiDecision = 'skip' | 'assign_client' | 'no_decision';

export interface InboundEmailAiClassifierInput {
  tenantId: string;
  providerId: string;
  ruleId: string;
  instruction: string;
  allowedOutcomes: AiClassifyActionConfig['allowed_outcomes'];
  subject?: string;
  fromAddress?: string;
  /** Pre-truncated body excerpt; callers must not pass full raw bodies. */
  bodyExcerpt: string;
}

export interface InboundEmailAiClassifierResult {
  decision: InboundEmailAiDecision;
  /**
   * For assign_client decisions: the client name the model extracted. The
   * model never picks a client_id — the deterministic exact+alias matcher
   * resolves this string, so AI and regex rules share matching semantics.
   */
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

export interface InboundEmailAiClassifier {
  classify(input: InboundEmailAiClassifierInput): Promise<InboundEmailAiClassifierResult>;
}

const defaultClassifier: InboundEmailAiClassifier = {
  async classify() {
    return {
      decision: 'no_decision',
      source: 'default',
      attempted: false,
      reason: 'default_non_ai',
      model: null,
      rawOutput: null,
      error: null,
    };
  },
};

let eeClassifierLoadAttempted = false;
let eeClassifier: InboundEmailAiClassifier | null = null;

async function loadEeClassifier(): Promise<InboundEmailAiClassifier | null> {
  if (eeClassifierLoadAttempted) {
    return eeClassifier;
  }

  eeClassifierLoadAttempted = true;
  try {
    const module = await import('@ee/services/email/inboundEmailRuleAiClassifier');
    if (module && typeof module.createInboundEmailRuleAiClassifier === 'function') {
      eeClassifier = module.createInboundEmailRuleAiClassifier();
    }
  } catch {
    eeClassifier = null;
  }

  return eeClassifier;
}

export async function resolveInboundEmailAiClassifier(): Promise<InboundEmailAiClassifier> {
  if (!isEnterprise) {
    return defaultClassifier;
  }

  const resolved = await loadEeClassifier();
  return resolved ?? defaultClassifier;
}
