// server/src/lib/actions/qbo/types.ts

/**
 * Represents a reference to another QBO object.
 */
export interface QboRef {
  value: string; // The ID of the referenced object
  name?: string; // Optional: The name/display name of the referenced object
}

/**
 * Represents a physical address in QBO.
 */
export interface QboAddress {
  Id?: string;
  Line1?: string;
  Line2?: string;
  Line3?: string;
  Line4?: string;
  Line5?: string;
  City?: string;
  Country?: string;
  CountrySubDivisionCode?: string; // State/Province
  PostalCode?: string;
  Lat?: string;
  Long?: string;
}

/**
 * Represents email address structure in QBO.
 */
export interface QboEmailAddr {
  Address: string;
}

/**
 * Represents phone number structure in QBO.
 */
export interface QboPhoneNumber {
  FreeFormNumber: string;
}

/**
 * Represents metadata common to QBO objects.
 */
export interface QboMetaData {
  CreateTime: string; // ISO 8601 format
  LastUpdatedTime: string; // ISO 8601 format
}

/**
 * Represents a QBO Customer object (subset based on mapping).
 */
export interface QboCustomer {
  Id?: string;
  SyncToken?: string;
  DisplayName?: string; // Maps from Alga Client Name
  GivenName?: string;
  MiddleName?: string;
  FamilyName?: string;
  ClientName?: string; // May also map from Alga Client Name if applicable
  PrimaryEmailAddr?: QboEmailAddr; // Maps from Alga Client billing_email
  BillAddr?: QboAddress; // Maps from Alga Client address
  ShipAddr?: QboAddress; // Maps from Alga Client address (if different)
  PrimaryPhone?: QboPhoneNumber; // Maps from Alga Client phone
  SalesTermRef?: QboRef; // Maps from Alga Client payment_terms via lookup
  MetaData?: QboMetaData;
  // Add other relevant fields as needed
}

/**
 * Represents transaction tax detail in QBO.
 */
export interface QboTxnTaxDetail {
  TxnTaxCodeRef?: QboRef;
  TotalTax?: number; // Decimal
  TaxLine?: QboTaxLine[];
}

/**
 * Represents a tax line detail within TxnTaxDetail.
 */
export interface QboTaxLine {
  Amount?: number; // Decimal
  TaxLineDetailType?: 'TaxLineDetail';
  TaxRateRef?: QboRef;
  PercentBased?: boolean;
  TaxPercent?: number; // Decimal
  NetAmountTaxable?: number; // Decimal
}

/**
 * Represents a line item detail for Sales Items in QBO Invoice/SalesReceipt lines.
 */
export interface QboSalesItemLineDetail {
  ItemRef: QboRef; // Maps from Alga service_id via lookup
  Qty?: number; // Maps from Alga quantity
  UnitPrice?: number; // Maps from Alga unit_price (converted)
  TaxCodeRef?: QboRef; // Maps from Alga tax_region via lookup
  ServiceDate?: string; // YYYY-MM-DD format, potentially from billing_period
  TaxInclusiveAmt?: boolean;
  // Add other relevant fields
}

/**
 * Represents a line item detail for Discounts in QBO Invoice/SalesReceipt lines.
 */
export interface QboDiscountLineDetail {
  DiscountAccountRef?: QboRef;
  PercentBased?: boolean; // Maps from Alga discount_type
  DiscountPercent?: number; // Maps from Alga discount_percentage (if PercentBased)
  DiscountAmount?: number; // Maps from Alga discount_amount (if not PercentBased)
  TaxCodeRef?: QboRef; // Tax code for the discount itself, if applicable
  ClassRef?: QboRef;
}

/**
 * Represents a line item on a QBO Invoice.
 */
export interface QboInvoiceLine {
  Id?: string;
  LineNum?: number;
  Description?: string; // Maps from Alga description
  Amount: number; // Maps from Alga total_price (converted), QBO calculates if Qty/UnitPrice provided
  DetailType: 'SalesItemLineDetail' | 'DiscountLineDetail' | 'DescriptionOnly' | 'SubTotalLineDetail' | 'GroupLineDetail';
  SalesItemLineDetail?: QboSalesItemLineDetail;
  DiscountLineDetail?: QboDiscountLineDetail;
  // Add other line detail types if needed
}

/**
 * Represents a QBO Invoice object (subset based on mapping).
 */
export interface QboInvoice {
  Id?: string;
  SyncToken?: string;
  DocNumber?: string; // Maps from Alga invoice_number
  TxnDate?: string; // Maps from Alga invoice_date (YYYY-MM-DD)
  CustomerRef: QboRef; // Maps from Alga client_id via lookup (qbo_customer_id)
  Line: QboInvoiceLine[]; // Maps from Alga invoice_charges
  DueDate?: string; // Maps from Alga due_date (YYYY-MM-DD)
  TotalAmt?: number; // Maps from Alga total_amount (converted), QBO calculates
  ApplyTaxAfterDiscount?: boolean;
  TxnTaxDetail?: QboTxnTaxDetail; // Maps from Alga tax details
  BillEmail?: QboEmailAddr; // Maps from Alga Client billing_email
  BillAddr?: QboAddress; // Maps from Alga Client address
  ShipAddr?: QboAddress; // Maps from Alga Client address (if different)
  SalesTermRef?: QboRef; // Maps from Alga Client payment_terms via lookup
  PrivateNote?: string; // Potential place for billing period info
  MetaData?: QboMetaData;
  CurrencyRef?: QboRef;
  ExchangeRate?: number;
  // Add other relevant fields as needed
}

/**
 * Represents a QBO Item object (subset for lookups).
 */
export interface QboItem {
  Id: string;
  SyncToken?: string;
  Name: string;
  Type: 'Service' | 'Inventory' | 'NonInventory' | 'Category';
  IncomeAccountRef?: QboRef;
  ExpenseAccountRef?: QboRef;
  AssetAccountRef?: QboRef;
  // Add other relevant fields
}

/**
 * Represents a QBO TaxCode object (subset for lookups).
 */
export interface QboTaxCode {
  Id: string;
  SyncToken?: string;
  Name: string;
  Description?: string;
  Taxable: boolean;
  TaxGroup: boolean;
  SalesTaxRateList?: {
    TaxRateDetail: QboTaxRateDetail[];
  };
  PurchaseTaxRateList?: {
    TaxRateDetail: QboTaxRateDetail[];
  };
  // Add other relevant fields
}

/**
 * Represents a TaxRate detail within a TaxCode.
 */
export interface QboTaxRateDetail {
  TaxRateRef: QboRef;
  TaxTypeApplicable?: string;
  TaxOrder?: number;
}

/**
 * Represents a QBO Term object (subset for lookups).
 */
export interface QboTerm {
  Id: string;
  SyncToken?: string;
  Name: string;
  Active?: boolean;
  Type?: 'STANDARD' | 'DATE_DRIVEN';
  DueDays?: number; // For STANDARD type
  // Add fields for DATE_DRIVEN if needed
}

/**
 * Represents the inner QueryResponse object structure.
 */
export interface QboInnerQueryResponse<T> {
  totalCount?: number;
  startPosition?: number;
  maxResults?: number;
  // The actual entity array will have a key matching the entity type (e.g., "Customer")
  [entityType: string]: T[] | number | undefined;
}

/**
 * Represents the structure of a QBO API query response.
 */
export interface QboQueryResponse<T> {
  QueryResponse: QboInnerQueryResponse<T>;
  time: string; // ISO 8601 timestamp
}


/**
 * Represents the structure of a single QBO API entity response.
 * The entity itself will be keyed by its type (e.g., "Customer").
 */
export interface QboEntityResponse<T> {
  [entityType: string]: T | string | undefined; // Allow for the 'time' property
  time: string; // ISO 8601 timestamp
}


/**
 * Represents a QBO API Error object.
 */
export interface QboErrorDetail {
  Message: string;
  Detail?: string;
  code?: string; // e.g., "6240"
  element?: string;
}

/**
 * Represents the Fault structure in a QBO API error response.
 */
export interface QboFault {
  Error: QboErrorDetail[];
  type: 'ValidationFault' | 'SystemFault' | 'AuthenticationFault' | 'AuthorizationFault';
}

/**
 * Represents a QBO API Error Response.
 */
export interface QboApiErrorResponse {
  Fault?: QboFault;
  warnings?: any; // Define warnings structure if needed
  time: string; // ISO 8601 timestamp
  intuit_tid?: string; // Transaction ID
}

/**
 * Represents the necessary credentials for QBO API access per tenant.
 * This should be retrieved securely.
 */
export interface QboTenantCredentials {
  accessToken: string;
  refreshToken: string;
  realmId: string;
  accessTokenExpiresAt?: string; // ISO 8601 format timestamp
  refreshTokenExpiresAt?: string; // ISO 8601 format timestamp
}
