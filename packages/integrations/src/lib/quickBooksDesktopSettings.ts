/**
 * QuickBooks Desktop (IIF) export settings stored in
 * tenant_settings.settings.quickbooksDesktop. Values are QuickBooks list
 * names; IIF imports create any name QuickBooks does not recognise, so these
 * must match the company file exactly.
 */
export type QuickBooksDesktopProductItemType = 'NONINVENTORY' | 'INVENTORY';

export interface QuickBooksDesktopSettings {
  arAccount: string;
  defaultIncomeAccount: string;
  salesTaxPayableAccount: string;
  defaultSalesTaxItem: string;
  /** Item type used when an export creates a new product in QuickBooks. */
  newProductItemType: QuickBooksDesktopProductItemType;
  /** Required for new Inventory Part items. */
  inventoryAssetAccount: string;
  /** Required for new Inventory Part items. */
  cogsAccount: string;
}

export const DEFAULT_QUICKBOOKS_DESKTOP_SETTINGS: QuickBooksDesktopSettings = {
  arAccount: 'Accounts Receivable',
  defaultIncomeAccount: '',
  salesTaxPayableAccount: 'Sales Tax Payable',
  defaultSalesTaxItem: '',
  newProductItemType: 'NONINVENTORY',
  inventoryAssetAccount: 'Inventory Asset',
  cogsAccount: 'Cost of Goods Sold',
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
    newProductItemType: pick('newProductItemType') === 'INVENTORY' ? 'INVENTORY' : 'NONINVENTORY',
    inventoryAssetAccount: pick('inventoryAssetAccount') || DEFAULT_QUICKBOOKS_DESKTOP_SETTINGS.inventoryAssetAccount,
    cogsAccount: pick('cogsAccount') || DEFAULT_QUICKBOOKS_DESKTOP_SETTINGS.cogsAccount,
  };
}
