import { useCurrencyFormat } from '@alga-psa/ui/lib';

/**
 * Formats template amounts in the template's own base currency (symbol and
 * fraction digits of `currency`). Every template surface that prints a template
 * amount uses this instead of the ambient `money()`, so an amount is never
 * labelled with a currency it is not in.
 */
export function useTemplateMoney(currency: string | undefined): (minorUnits: number) => string {
  const { money } = useCurrencyFormat();
  return (minorUnits: number): string => (currency ? money(Math.round(Number(minorUnits)), currency) : money(Math.round(Number(minorUnits))));
}
