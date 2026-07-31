export const KNOWN_AI_FEATURES = new Set([
  'chat',
  'chat-title',
  'email-reply-ack',
  'email-rule-classifier',
  'opportunity-drafting',
  'workflow-inference',
  'inventory-classifier',
  'document-assist',
]);

export function readFeatureHeader(value: string | undefined): string {
  const feature = value?.trim();
  if (!feature) {
    throw new Error('X-Alga-AI-Feature is required');
  }
  if (!KNOWN_AI_FEATURES.has(feature)) {
    console.warn(`[ai-gateway] Unknown X-Alga-AI-Feature value accepted: ${feature}`);
  }
  return feature;
}
