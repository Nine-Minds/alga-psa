'use client';

import { useState } from 'react';
import { useRouter } from 'next/router';

interface StatementDetailProps {
  statementId: string;
}

// Dummy data
const dummyStatements = [
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
    status: 'finalized' as const,
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
    status: 'imported' as const,
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
    status: 'draft' as const,
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
    status: 'finalized' as const,
    createdAt: '2025-01-05T12:00:00Z'
  }
];

const dummyCharges: Record<string, any[]> = {
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
    }
  ]
};

export default function StatementDetail({ statementId }: StatementDetailProps) {
  const router = useRouter();
  const [showSuccess, setShowSuccess] = useState(false);
  
  // Find the statement from dummy data
  const statement = dummyStatements.find(s => s.id === statementId);
  const charges = dummyCharges[statementId] || [];
  
  if (!statement) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">Statement not found</p>
        </div>
        <button
          onClick={() => router.push('/softwareone/statements')}
          className="mt-4 px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
        >
          Back to Statements
        </button>
      </div>
    );
  }

  const handleImport = () => {
    // Show success message
    setShowSuccess(true);
    // Hide after 3 seconds
    setTimeout(() => setShowSuccess(false), 3000);
  };

  const getStatusBadge = (status: 'draft' | 'finalized' | 'imported') => {
    const colors = {
      draft: 'bg-gray-100 text-gray-800',
      finalized: 'bg-blue-100 text-blue-800',
      imported: 'bg-green-100 text-green-800'
    };

    return (
      <span className={`px-3 py-1 rounded-full text-sm font-medium ${colors[status]}`}>
        {status}
      </span>
    );
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Calculate totals
  const subtotal = charges.reduce((sum, charge) => sum + charge.totalPrice, 0);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => router.push('/softwareone/statements')}
          className="text-blue-600 hover:text-blue-800 text-sm mb-4 flex items-center"
        >
          ← Back to Statements
        </button>
        
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              Statement {statement.period}
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              {statement.agreementName}
            </p>
          </div>
          <div className="flex items-center space-x-4">
            {getStatusBadge(statement.status)}
            {statement.status !== 'imported' && (
              <button
                onClick={handleImport}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Import to Invoice
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Success Message */}
      {showSuccess && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-green-800">Statement imported to invoice successfully!</p>
        </div>
      )}

      {/* Statement Summary */}
      <div className="bg-white shadow rounded-lg mb-6">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Statement Summary</h2>
        </div>
        
        <div className="px-6 py-4">
          <dl className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <div>
              <dt className="text-sm font-medium text-gray-500">Period</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {formatDate(statement.startDate)} - {formatDate(statement.endDate)}
              </dd>
            </div>
            
            <div>
              <dt className="text-sm font-medium text-gray-500">Total Amount</dt>
              <dd className="mt-1 text-sm font-semibold text-gray-900">
                {formatCurrency(statement.totalAmount, statement.currency)}
              </dd>
            </div>
            
            <div>
              <dt className="text-sm font-medium text-gray-500">Line Items</dt>
              <dd className="mt-1 text-sm text-gray-900">{statement.lineItemCount} items</dd>
            </div>
            
            <div>
              <dt className="text-sm font-medium text-gray-500">Created</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {formatDate(statement.createdAt)}
              </dd>
            </div>
            
            {statement.importedAt && (
              <div>
                <dt className="text-sm font-medium text-gray-500">Imported</dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {formatDate(statement.importedAt)}
                </dd>
              </div>
            )}
          </dl>
        </div>
      </div>

      {/* Charges Table */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Charges</h2>
        </div>
        
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Product
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Description
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Quantity
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Unit Price
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {charges.length > 0 ? (
                charges.map((charge) => (
                  <tr key={charge.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {charge.productName}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {charge.description || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                      {charge.quantity.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                      {formatCurrency(charge.unitPrice, charge.currency)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 text-right">
                      {formatCurrency(charge.totalPrice, charge.currency)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">
                    No charge details available for this statement
                  </td>
                </tr>
              )}
            </tbody>
            {charges.length > 0 && (
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={4} className="px-6 py-3 text-right text-sm font-medium text-gray-900">
                    Subtotal
                  </td>
                  <td className="px-6 py-3 text-right text-sm font-medium text-gray-900">
                    {formatCurrency(subtotal, statement.currency)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}