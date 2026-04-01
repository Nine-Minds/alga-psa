import type {
  TemplateTransformOperation,
  TemplateTransformPipeline,
} from '@alga-psa/types';
import type { DesignerTransformWorkspace } from '../state/designerStore';

export type DesignerTransformValidationIssue = {
  code: 'MISSING_SOURCE' | 'MISSING_OUTPUT' | 'MISSING_OPERATIONS' | 'INVALID_SEQUENCE';
  message: string;
  operationId?: string;
};

const cloneJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

export const cloneDesignerTransformWorkspace = (
  transforms: DesignerTransformWorkspace
): DesignerTransformWorkspace => cloneJson(transforms);

export const hasDesignerTransforms = (transforms: DesignerTransformWorkspace): boolean =>
  transforms.sourceBindingId.trim().length > 0 &&
  transforms.outputBindingId.trim().length > 0 &&
  transforms.operations.length > 0;

export const validateDesignerTransformWorkspace = (
  transforms: DesignerTransformWorkspace
): DesignerTransformValidationIssue[] => {
  const issues: DesignerTransformValidationIssue[] = [];
  const hasSource = transforms.sourceBindingId.trim().length > 0;
  const hasOutput = transforms.outputBindingId.trim().length > 0;
  const hasOperations = transforms.operations.length > 0;

  if ((hasOutput || hasOperations) && !hasSource) {
    issues.push({
      code: 'MISSING_SOURCE',
      message: 'Choose a source collection before authoring transforms.',
    });
  }

  if ((hasSource || hasOperations) && !hasOutput) {
    issues.push({
      code: 'MISSING_OUTPUT',
      message: 'Set an output binding ID before previewing or saving transforms.',
    });
  }

  if ((hasSource || hasOutput) && !hasOperations) {
    issues.push({
      code: 'MISSING_OPERATIONS',
      message: 'Add at least one transform operation before saving the pipeline.',
    });
  }

  let grouped = false;
  for (const operation of transforms.operations) {
    if (
      grouped &&
      (operation.type === 'filter' || operation.type === 'sort' || operation.type === 'computed-field')
    ) {
      issues.push({
        code: 'INVALID_SEQUENCE',
        operationId: operation.id,
        message: `Operation "${operation.id}" (${operation.type}) cannot run after grouped output.`,
      });
    }
    if (operation.type === 'group') {
      grouped = true;
    }
  }

  return issues;
};

export const toTemplateTransformPipeline = (
  transforms: DesignerTransformWorkspace
): TemplateTransformPipeline | undefined => {
  if (!hasDesignerTransforms(transforms)) {
    return undefined;
  }

  return {
    sourceBindingId: transforms.sourceBindingId.trim(),
    outputBindingId: transforms.outputBindingId.trim(),
    operations: cloneJson(transforms.operations) as TemplateTransformOperation[],
  };
};

export const suggestTransformOutputBindingId = (sourceBindingId: string): string => {
  const trimmed = sourceBindingId.trim();
  if (!trimmed) {
    return 'transformedItems';
  }
  const normalized = trimmed.replace(/[^a-zA-Z0-9_.-]+/g, '_');
  return normalized.endsWith('.transformed') ? normalized : `${normalized}.transformed`;
};
