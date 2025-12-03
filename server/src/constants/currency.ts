
export interface CurrencyOption {
  value: string;
  label: string;
  symbol: string;
}

export const CURRENCY_OPTIONS: CurrencyOption[] = [
  { value: 'USD', label: 'USD - US Dollar', symbol: '$' },
  { value: 'EUR', label: 'EUR - Euro', symbol: '€' },
  { value: 'GBP', label: 'GBP - British Pound', symbol: '£' },
  { value: 'CAD', label: 'CAD - Canadian Dollar', symbol: 'C$' },
  { value: 'AUD', label: 'AUD - Australian Dollar', symbol: 'A$' },
  { value: 'JPY', label: 'JPY - Japanese Yen', symbol: '¥' },
];

export const getCurrencySymbol = (code: string): string => {
  const currency = CURRENCY_OPTIONS.find(c => c.value === code);
  return currency ? currency.symbol : '$';
};
