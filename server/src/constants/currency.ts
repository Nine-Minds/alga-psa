
export interface CurrencyOption {
  value: string;
  label: string;
  symbol: string;
}

export const CURRENCY_OPTIONS: CurrencyOption[] = [
  { value: 'USD', label: 'USD ($)', symbol: '$' },
  { value: 'EUR', label: 'EUR (€)', symbol: '€' },
  { value: 'GBP', label: 'GBP (£)', symbol: '£' },
  { value: 'CAD', label: 'CAD (C$)', symbol: 'C$' },
  { value: 'AUD', label: 'AUD (A$)', symbol: 'A$' },
  { value: 'JPY', label: 'JPY (¥)', symbol: '¥' },
];

export const getCurrencySymbol = (code: string): string => {
  const currency = CURRENCY_OPTIONS.find(c => c.value === code);
  return currency ? currency.symbol : '$';
};
