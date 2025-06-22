'use client';

import { useRouter } from 'next/router';

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

export default function StatementsList() {
  const router = useRouter();

  const handleRowClick = (statementId: string) => {
    router.push(`/softwareone/statement/${statementId}`);
  };

  const getStatusBadge = (status: 'draft' | 'finalized' | 'imported') => {
    const colors = {
      draft: 'bg-gray-100 text-gray-800',
      finalized: 'bg-blue-100 text-blue-800',
      imported: 'bg-green-100 text-green-800'
    };

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status]}`}>
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

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Statements</h1>
        <p className="mt-1 text-sm text-gray-600">
          View and import SoftwareOne billing statements
        </p>
      </div>

      <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 rounded-lg">
        <table className="min-w-full divide-y divide-gray-300">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Period
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Agreement
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Total Amount
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Line Items
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Created
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {dummyStatements.map((statement) => (
              <tr
                key={statement.id}
                onClick={() => handleRowClick(statement.id)}
                className="hover:bg-gray-50 cursor-pointer"
              >
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">
                    {statement.period}
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatDate(statement.startDate)} - {formatDate(statement.endDate)}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="text-sm text-gray-900">
                    {statement.agreementName}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">
                    {formatCurrency(statement.totalAmount, statement.currency)}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">
                    {statement.lineItemCount} items
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {getStatusBadge(statement.status)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">
                    {formatDate(statement.createdAt)}
                  </div>
                  {statement.importedAt && (
                    <div className="text-xs text-gray-500">
                      Imported: {formatDate(statement.importedAt)}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}