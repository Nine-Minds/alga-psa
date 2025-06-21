import { Statement, StatementCharge } from '../types/statement';

export const dummyStatements: Statement[] = [
  {
    id: 's1',
    agreementId: '1',
    agreementName: 'Microsoft Enterprise Agreement - Acme Corp',
    period: '2024-12',
    startDate: '2024-12-01',
    endDate: '2024-12-31',
    totalAmount: 45250.00,
    currency: 'USD',
    lineItemCount: 15,
    status: 'finalized',
    createdAt: '2025-01-05T10:00:00Z'
  },
  {
    id: 's2',
    agreementId: '1',
    agreementName: 'Microsoft Enterprise Agreement - Acme Corp',
    period: '2024-11',
    startDate: '2024-11-01',
    endDate: '2024-11-30',
    totalAmount: 42150.00,
    currency: 'USD',
    lineItemCount: 14,
    status: 'imported',
    createdAt: '2024-12-05T10:00:00Z',
    importedAt: '2024-12-10T14:30:00Z'
  },
  {
    id: 's3',
    agreementId: '2',
    agreementName: 'Adobe Creative Cloud - Design Team',
    period: '2024-12',
    startDate: '2024-12-01',
    endDate: '2024-12-31',
    totalAmount: 8540.00,
    currency: 'USD',
    lineItemCount: 8,
    status: 'draft',
    createdAt: '2025-01-05T11:00:00Z'
  },
  {
    id: 's4',
    agreementId: '4',
    agreementName: 'AWS Cloud Services - Tech Startup',
    period: '2024-12',
    startDate: '2024-12-01',
    endDate: '2024-12-31',
    totalAmount: 125670.50,
    currency: 'USD',
    lineItemCount: 45,
    status: 'finalized',
    createdAt: '2025-01-05T12:00:00Z'
  },
  {
    id: 's5',
    agreementId: '5',
    agreementName: 'Google Workspace - Education',
    period: '2024-12',
    startDate: '2024-12-01',
    endDate: '2024-12-31',
    totalAmount: 15200.00,
    currency: 'USD',
    lineItemCount: 20,
    status: 'finalized',
    createdAt: '2025-01-05T13:00:00Z'
  },
  {
    id: 's6',
    agreementId: '7',
    agreementName: 'Slack Business+ - Communications',
    period: '2024-12',
    startDate: '2024-12-01',
    endDate: '2024-12-31',
    totalAmount: 3200.00,
    currency: 'USD',
    lineItemCount: 5,
    status: 'imported',
    createdAt: '2025-01-05T14:00:00Z',
    importedAt: '2025-01-08T09:15:00Z'
  }
];

// Dummy charges for statement details
export const dummyCharges: Record<string, StatementCharge[]> = {
  's1': [
    {
      id: 'c1-1',
      statementId: 's1',
      productName: 'Microsoft 365 E5',
      quantity: 150,
      unitPrice: 57.00,
      totalPrice: 8550.00,
      currency: 'USD',
      description: 'Enterprise licenses'
    },
    {
      id: 'c1-2',
      statementId: 's1',
      productName: 'Exchange Online Plan 2',
      quantity: 50,
      unitPrice: 8.00,
      totalPrice: 400.00,
      currency: 'USD',
      description: 'Additional mailboxes'
    },
    {
      id: 'c1-3',
      statementId: 's1',
      productName: 'Azure Active Directory Premium P2',
      quantity: 200,
      unitPrice: 9.00,
      totalPrice: 1800.00,
      currency: 'USD',
      description: 'Identity management'
    },
    {
      id: 'c1-4',
      statementId: 's1',
      productName: 'Power BI Pro',
      quantity: 75,
      unitPrice: 10.00,
      totalPrice: 750.00,
      currency: 'USD',
      description: 'Business intelligence'
    },
    {
      id: 'c1-5',
      statementId: 's1',
      productName: 'Azure Compute - D4s v3',
      quantity: 2880,
      unitPrice: 11.50,
      totalPrice: 33120.00,
      currency: 'USD',
      description: 'Virtual machine hours'
    }
  ],
  's4': [
    {
      id: 'c4-1',
      statementId: 's4',
      productName: 'EC2 - m5.large',
      quantity: 5040,
      unitPrice: 0.096,
      totalPrice: 483.84,
      currency: 'USD',
      description: 'On-demand instances'
    },
    {
      id: 'c4-2',
      statementId: 's4',
      productName: 'RDS - db.t3.medium',
      quantity: 1440,
      unitPrice: 0.068,
      totalPrice: 97.92,
      currency: 'USD',
      description: 'Database hours'
    },
    {
      id: 'c4-3',
      statementId: 's4',
      productName: 'S3 Storage',
      quantity: 50000,
      unitPrice: 0.023,
      totalPrice: 1150.00,
      currency: 'USD',
      description: 'Standard storage (GB)'
    },
    {
      id: 'c4-4',
      statementId: 's4',
      productName: 'CloudFront',
      quantity: 10000,
      unitPrice: 0.085,
      totalPrice: 850.00,
      currency: 'USD',
      description: 'Data transfer (GB)'
    },
    {
      id: 'c4-5',
      statementId: 's4',
      productName: 'Lambda',
      quantity: 5000000,
      unitPrice: 0.0000002,
      totalPrice: 1000.00,
      currency: 'USD',
      description: 'Function invocations'
    }
  ]
};