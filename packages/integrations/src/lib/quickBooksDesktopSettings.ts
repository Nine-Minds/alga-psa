/**
 * QuickBooks Desktop (IIF) export settings stored in
 * tenant_settings.settings.quickbooksDesktop. Values are QuickBooks list
 * names; IIF imports create any name QuickBooks does not recognise, so these
 * must match the company file exactly.
 */
export interface QuickBooksDesktopSettings {
  arAccount: string;
  defaultIncomeAccount: string;
  salesTaxPayableAccount: string;
  defaultSalesTaxItem: string;
}

export const DEFAULT_QUICKBOOKS_DESKTOP_SETTINGS: QuickBooksDesktopSettings = {
  arAccount: 'Accounts Receivable',
  defaultIncomeAccount: '',
  salesTaxPayableAccount: 'Sales Tax Payable',
  defaultSalesTaxItem: '',
};

export function normalizeQuickBooksDesktopSettings(raw: unknown): QuickBooksDesktopSettings {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const pick = (key: keyof QuickBooksDesktopSettings): string => {
    const value = source[key];
    return typeof value === 'string' ? value.trim() : '';
  };
  return {
    arAccount: pick('arAccount') || DEFAULT_QUICKBOOKS_DESKTOP_SETTINGS.arAccount,
    defaultIncomeAccount: pick('defaultIncomeAccount'),
    salesTaxPayableAccount: pick('salesTaxPayableAccount') || DEFAULT_QUICKBOOKS_DESKTOP_SETTINGS.salesTaxPayableAccount,
    defaultSalesTaxItem: pick('defaultSalesTaxItem'),
  };
}
