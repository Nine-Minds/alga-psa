import type { ForEachBlock, IfBlock, InputMapping, Step, TryCatchBlock, WorkflowDefinition } from '@alga-psa/workflows/runtime';

const isEmptyExpression = (value: unknown): boolean =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  '$expr' in (value as Record<string, unknown>) &&
  String((value as { $expr?: unknown }).$expr ?? '').trim() === '';

const stripEmptyMappingEntries = (mapping: InputMapping): InputMapping =>
  Object.fromEntries(Object.entries(mapping).filter(([, value]) => !isEmptyExpression(value))) as InputMapping;

/**
 * The editor represents an untouched Reference/Expression field as `{ $expr: '' }`.
 * Persisting that would fail validation and runtime compilation, so drop those entries.
 * Required fields then surface as MISSING_REQUIRED_MAPPING, which is the accurate message.
 */
export const stripEmptyActionInputExpressions = (steps: Step[]): Step[] =>
  steps.map((step) => {
    switch (step.type) {
      case 'control.if': {
        const block = step as IfBlock;
        return { ...block, then: stripEmptyActionInputExpressions(block.then), else: block.else ? stripEmptyActionInputExpressions(block.else) : block.else };
      }
      case 'control.forEach': {
        const block = step as ForEachBlock;
        return { ...block, body: stripEmptyActionInputExpressions(block.body) };
      }
      case 'control.tryCatch': {
        const block = step as TryCatchBlock;
        return { ...block, try: stripEmptyActionInputExpressions(block.try), catch: stripEmptyActionInputExpressions(block.catch) };
      }
      case 'action.call': {
        const config = step.config as { inputMapping?: InputMapping } | undefined;
        if (!config?.inputMapping) return step;
        return { ...step, config: { ...config, inputMapping: stripEmptyMappingEntries(config.inputMapping) } };
      }
      default:
        return step;
    }
  });

export const normalizeWorkflowDefinitionSteps = (definition: WorkflowDefinition): WorkflowDefinition =>
  Array.isArray(definition.steps)
    ? { ...definition, steps: stripEmptyActionInputExpressions(definition.steps) }
    : definition;
