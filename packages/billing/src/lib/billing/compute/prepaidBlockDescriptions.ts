/**
 * Invoice-line wording for the prepaid-block family. One place owns the text so
 * the engine, the preview/simulator and the persisted invoice agree. Keys live
 * in `features/billing` (`invoiceLines.*`) in every locale; compute is pure and
 * synchronous, so a caller that has a translator passes it in, and the default
 * renders the English `defaultValue` (kept equal to the `en` file by a test).
 */

export type InvoiceLineTranslator = (
  key: string,
  options: { defaultValue: string; [param: string]: unknown },
) => string;

export const PREPAID_BLOCK_FEE_KEY = "invoiceLines.prepaidBlockFee";
export const PREPAID_BLOCK_FEE_DEFAULT = "{{name}} — prepaid block, {{hours}} h";
export const OVER_PREPAID_BLOCK_KEY = "invoiceLines.overPrepaidBlock";
export const OVER_PREPAID_BLOCK_DEFAULT = "{{name}} (over prepaid block)";

const defaultTranslator: InvoiceLineTranslator = (_key, { defaultValue, ...params }) =>
  defaultValue.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(params[name] ?? ""));

/** 10 -> "10", 7.5 -> "7.5", 1.333 -> "1.33". */
export function formatPrepaidBlockHours(hours: number): string {
  return String(Number(hours.toFixed(2)));
}

/** `{line name} — prepaid block, {hours} h` */
export function prepaidBlockFeeDescription(
  input: { name: string; hours: number },
  t: InvoiceLineTranslator = defaultTranslator,
): string {
  return t(PREPAID_BLOCK_FEE_KEY, {
    defaultValue: PREPAID_BLOCK_FEE_DEFAULT,
    name: input.name,
    hours: formatPrepaidBlockHours(input.hours),
  });
}

/** `{line name} (over prepaid block)` for time past a block's coverage. */
export function overPrepaidBlockDescription(
  name: string,
  t: InvoiceLineTranslator = defaultTranslator,
): string {
  return t(OVER_PREPAID_BLOCK_KEY, { defaultValue: OVER_PREPAID_BLOCK_DEFAULT, name });
}
