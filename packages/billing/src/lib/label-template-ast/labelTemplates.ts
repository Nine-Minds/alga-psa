import { isLabelClass, type LabelClass, type TemplateAst } from '@alga-psa/types';

import { LABEL_CLASS_BY_STANDARD_CODE } from './standardTemplates';

/**
 * The label class a `work-tag` template prints. Customs record it in `metadata.labelClass`; a custom
 * without it is treated as a ticket work tag (read-time default - C1 shipped no tenant label usage, so
 * nothing needs migrating).
 */
export const DEFAULT_CUSTOM_LABEL_CLASS: LabelClass = 'ticket-work-tag';

export function labelClassOfCustomTemplate(ast: Pick<TemplateAst, 'metadata'> | null | undefined): LabelClass {
  const value = ast?.metadata?.labelClass;
  return isLabelClass(value) ? value : DEFAULT_CUSTOM_LABEL_CLASS;
}

export function labelClassOfStandardCode(code: string): LabelClass | null {
  return LABEL_CLASS_BY_STANDARD_CODE[code] ?? null;
}
