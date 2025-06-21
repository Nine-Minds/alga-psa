// Simple Statement interface for MVP
export interface Statement {
  id: string;
  agreementId: string;
  agreementName: string;
  period: string; // e.g., "2024-01"
  startDate: string;
  endDate: string;
  totalAmount: number;
  currency: string;
  lineItemCount: number;
  status: 'draft' | 'finalized' | 'imported';
  createdAt: string;
  importedAt?: string;
}

// Statement line item / charge
export interface StatementCharge {
  id: string;
  statementId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  currency: string;
  description?: string;
}

// Combined type for display
export interface StatementWithCharges extends Statement {
  charges?: StatementCharge[];
}