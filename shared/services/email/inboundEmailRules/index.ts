export * from './types';
export {
  MAX_BODY_TEXT_LENGTH,
  MAX_REGEX_PATTERN_LENGTH,
  buildRuleEmailInput,
  evaluateCondition,
  evaluateConditions,
  extractValue,
  extractionToRegexSource,
  normalizeExtractedValue,
} from './evaluator';
export {
  evaluateInboundEmailRules,
  type EvaluateInboundEmailRulesParams,
  type InboundEmailRuleEngineDeps,
} from './engine';
export {
  resolveInboundEmailAiClassifier,
  type InboundEmailAiClassifier,
  type InboundEmailAiClassifierInput,
  type InboundEmailAiClassifierResult,
  type InboundEmailAiDecision,
} from './aiClassifier';
export {
  aiClassifyConfigSchema,
  clientNameAliasInputSchema,
  extractAssignClientConfigSchema,
  inboundEmailExtractionSchema,
  inboundEmailRuleConditionSchema,
  inboundEmailRuleInputSchema,
  inboundEmailRuleTestSampleSchema,
  setDestinationConfigSchema,
  type ClientNameAliasInput,
  type InboundEmailRuleInput,
  type InboundEmailRuleTestSample,
} from './validation';
