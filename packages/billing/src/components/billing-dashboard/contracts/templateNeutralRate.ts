import { useFormatters } from '@alga-psa/ui/lib/i18n/client';
import { useCurrencyFormat } from '@alga-psa/ui/lib';

/**
 * Contract templates are currency-neutral: a template has no currency, and a
 * contract created from it uses the client's currency. Template rates are
 * therefore shown as a plain number (minor units scaled by the authoring
 * currency's fraction digits, the same scale the rate input uses) with no
 * currency symbol or code. The "in the client's currency" note lives in the
 * translated string (`templateReview.fixed.unitRateNeutral`).
 *
 * Every template surface that prints a template rate must use this instead of
 * `money()`, so a template can never be labelled with a currency it does not have.
 */
export function useTemplateNeutralRate(): (minorUnits: number) => string {
  const { fractionDigits } = useCurrencyFormat();
  const { formatNumber } = useFormatters();

  return (minorUnits: number): string => {
    const digits = fractionDigits();
    return formatNumber(Math.round(Number(minorUnits)) / 10 ** digits, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  };
}
