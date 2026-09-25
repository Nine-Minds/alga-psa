import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type ChecklistActionError = ActionMessageError | ActionPermissionError;

export const APPLY_RULE_CATEGORY_BOARD_MISMATCH = 'The selected category belongs to a different board than the rule.';
export const APPLY_RULE_CATEGORY_INVALID = 'The selected category is not a top-level category.';
export const APPLY_RULE_SUBCATEGORY_INVALID = 'The selected subcategory does not belong to the selected category.';
export const APPLY_RULE_SUBCATEGORY_REQUIRES_CATEGORY = 'Select a category before choosing a subcategory.';

const APPLY_RULE_SCOPE_ERROR_KEYS: Record<string, string> = {
  [APPLY_RULE_CATEGORY_BOARD_MISMATCH]: 'features/tickets:errors.checklist.ruleCategoryBoardMismatch',
  [APPLY_RULE_CATEGORY_INVALID]: 'features/tickets:errors.checklist.ruleCategoryInvalid',
  [APPLY_RULE_SUBCATEGORY_INVALID]: 'features/tickets:errors.checklist.ruleSubcategoryInvalid',
  [APPLY_RULE_SUBCATEGORY_REQUIRES_CATEGORY]: 'features/tickets:errors.checklist.ruleSubcategoryRequiresCategory',
};

const EXPECTED_CHECKLIST_MESSAGES = new Set([
  'Ticket not found',
  'Checklist item name is required',
  'Checklist item not found',
  'Template name is required',
  'Checklist template not found',
  'Item name is required',
  'Template item not found',
  'Apply rule not found',
]);

export function checklistActionErrorFrom(error: unknown): ChecklistActionError | null {
  if (error instanceof Error) {
    if (error.message.includes('Permission denied')) {
      return permissionError(error.message);
    }
    const scopeErrorKey = APPLY_RULE_SCOPE_ERROR_KEYS[error.message];
    if (scopeErrorKey) {
      return actionError(error.message, scopeErrorKey);
    }
    if (EXPECTED_CHECKLIST_MESSAGES.has(error.message)) {
      return actionError(error.message);
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('The selected checklist item, template, or rule is invalid. Please refresh and try again.', 'features/tickets:errors.checklist.invalidReference');
  }
  if (dbError?.code === '23502') {
    return dbError.column
      ? actionError(
          `Missing required checklist field: ${dbError.column}.`,
          'features/tickets:errors.checklist.missingFieldNamed',
          { field: dbError.column },
        )
      : actionError('Missing required checklist field.', 'features/tickets:errors.checklist.missingField');
  }
  if (dbError?.code === '23503') {
    return actionError('The selected ticket, checklist template, or rule filter is no longer valid. Please refresh and try again.', 'features/tickets:errors.checklist.referenceInvalid');
  }
  if (dbError?.code === '23514') {
    return actionError('One of the checklist values is invalid. Please refresh and try again.', 'features/tickets:errors.checklist.invalidValue');
  }

  return null;
}
