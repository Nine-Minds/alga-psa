import { canSendAsOneItemList } from './typeCompatibility';

const ONE_ITEM_LIST_REFERENCE = /^\[\s*([A-Za-z_$][A-Za-z0-9_$.]*)\s*\]$/;

/**
 * The expression a Reference-mode pick writes. A single value picked for a list input is sent as a
 * one-item list (`[path]`), so the user never has to hand-write the brackets.
 */
export const buildReferenceExpression = (
  path: string,
  sourceType: string | undefined,
  targetType: string | undefined
): string => (canSendAsOneItemList(sourceType, targetType) ? `[${path}]` : path);

/** The referenced path inside a one-item-list reference (`[vars.x.y]` → `vars.x.y`), else null. */
export const getOneItemListReferencePath = (expression: string | undefined): string | null =>
  ONE_ITEM_LIST_REFERENCE.exec(expression?.trim() ?? '')?.[1] ?? null;

/**
 * Type of the value a reference expression produces: a one-item-list reference produces a list of
 * the referenced field's type.
 */
export const getReferenceExpressionType = (
  expression: string | undefined,
  resolvePathType: (path: string) => string | undefined
): string | undefined => {
  const listPath = getOneItemListReferencePath(expression);
  if (listPath) {
    const itemType = resolvePathType(listPath)?.split('|').map((part) => part.trim()).find((part) => part && part !== 'null');
    return itemType ? `array<${itemType}>` : 'array';
  }
  return undefined;
};
