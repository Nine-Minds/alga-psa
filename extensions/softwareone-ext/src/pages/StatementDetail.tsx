import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as Tabs from '@radix-ui/react-tabs';
import { ExtensionContext, Statement, Agreement } from '../types';
import { useSwoneQuery } from '../hooks/useSwoneQuery';

interface StatementDetailProps {
  context: ExtensionContext;
}

export const StatementDetail: React.FC<StatementDetailProps> = ({ context }) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { storage, logger } = context;
  
  const [activeTab, setActiveTab] = useState('charges');

  // Fetch statement details
  const { data: statement, isLoading, error } = useSwoneQuery<Statement | null>(
    ['statement', id || ''],
    async () => {
      if (!id) return null;
      const namespace = storage.getNamespace('swone');
      const byId = await namespace.get('statements/byId') || {};
      return byId[id] || null;
    }
  );

  // Fetch related agreements for charges
  const { data: agreements } = useSwoneQuery<Record<string, Agreement>>(
    ['agreements/byId'],
    async () => {
      const namespace = storage.getNamespace('swone');
      return await namespace.get('agreements/byId') || {};
    }
  );

  // Handle billing action
  const handleBillStatement = async () => {
    try {
      logger.info('Billing statement', { statementId: id });
      
      // TODO: Integrate with Alga billing system
      // This would create invoice items from statement charges
      
      alert('Billing integration will be implemented in the next phase');
    } catch (error) {
      logger.error('Failed to bill statement', error);
    }
  };

  if (isLoading) {
    return <div className="p-6">Loading statement details...</div>;
  }

  if (error || !statement) {
    return (
      <div className="p-6">
        <div className="p-4 rounded-md bg-red-50 text-red-800 border border-red-200">
          Failed to load statement details
        </div>
        <button 
          onClick={() => navigate('/softwareone/statements')} 
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Back to Statements
        </button>
      </div>
    );
  }

  // Enhanced charges with agreement details
  const chargesWithAgreements = statement.charges.map(charge => ({
    ...charge,
    agreementName: agreements?.[charge.agreementId]?.name || 'Unknown Agreement',
    vendor: agreements?.[charge.agreementId]?.vendor || '-',
    product: agreements?.[charge.agreementId]?.product || '-',
  }));

  // Group charges by agreement
  const chargesByAgreement = chargesWithAgreements.reduce((acc, charge) => {
    if (!acc[charge.agreementId]) {
      acc[charge.agreementId] = {
        agreementId: charge.agreementId,
        agreementName: charge.agreementName,
        vendor: charge.vendor,
        product: charge.product,
        charges: [],
        totalAmount: 0
      };
    }
    acc[charge.agreementId].charges.push(charge);
    acc[charge.agreementId].totalAmount += charge.totalAmount;
    return acc;
  }, {} as Record<string, any>);

  return (
    <div className="p-6">
      <div className="flex justify-between items-start mb-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => navigate('/softwareone/statements')}
              className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
            >
              ← Back
            </button>
          </div>
          <h1 className="text-2xl font-bold">Statement {statement.statementNumber}</h1>
          <p className="text-gray-600">
            {new Date(statement.periodStart).toLocaleDateString()} - {new Date(statement.periodEnd).toLocaleDateString()}
          </p>
        </div>
        
        <div className="flex gap-3">
          {statement.status === 'final' && (
            <button 
              onClick={handleBillStatement}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Create Invoice
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6 mb-6">
        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-500 mb-1">Total Amount</h3>
          <p className="text-2xl font-bold">
            {statement.currency} {statement.totalAmount.toLocaleString()}
          </p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-500 mb-1">Status</h3>
          <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
            statement.status === 'draft' ? 'bg-yellow-100 text-yellow-800' :
            statement.status === 'final' ? 'bg-blue-100 text-blue-800' :
            'bg-green-100 text-green-800'
          }`}>
            {statement.status.charAt(0).toUpperCase() + statement.status.slice(1)}
          </span>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-500 mb-1">Charges</h3>
          <p className="text-2xl font-bold">{statement.charges.length}</p>
        </div>
      </div>

      <Tabs.Root value={activeTab} onValueChange={setActiveTab} className="w-full">
        <Tabs.List className="flex border-b mb-6">
          <Tabs.Trigger value="charges" className="px-4 py-2 hover:bg-gray-50 data-[state=active]:border-b-2 data-[state=active]:border-blue-500">
            Charges ({statement.charges.length})
          </Tabs.Trigger>
          <Tabs.Trigger value="summary" className="px-4 py-2 hover:bg-gray-50 data-[state=active]:border-b-2 data-[state=active]:border-blue-500">
            Summary by Agreement
          </Tabs.Trigger>
          <Tabs.Trigger value="details" className="px-4 py-2 hover:bg-gray-50 data-[state=active]:border-b-2 data-[state=active]:border-blue-500">
            Details
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="charges">
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Agreement
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Description
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Quantity
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Unit Price
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {chargesWithAgreements.map((charge) => (
                    <tr key={charge.id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          onClick={() => navigate(`/softwareone/agreement/${charge.agreementId}`)}
                          className="text-blue-600 hover:underline text-sm"
                        >
                          {charge.agreementName}
                        </button>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {charge.description}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {charge.chargeDate}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {charge.quantity}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {statement.currency} {charge.unitPrice}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {statement.currency} {charge.totalAmount.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="summary">
          <div className="space-y-4">
            {Object.values(chargesByAgreement).map((group: any) => (
              <div key={group.agreementId} className="bg-white p-6 rounded-lg shadow">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-semibold">
                      <button
                        onClick={() => navigate(`/softwareone/agreement/${group.agreementId}`)}
                        className="text-blue-600 hover:underline"
                      >
                        {group.agreementName}
                      </button>
                    </h3>
                    <p className="text-sm text-gray-600">
                      {group.vendor} • {group.product}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold">
                      {statement.currency} {group.totalAmount.toLocaleString()}
                    </p>
                    <p className="text-sm text-gray-600">
                      {group.charges.length} charges
                    </p>
                  </div>
                </div>
                
                <div className="border-t pt-4">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Description
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Qty
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {group.charges.slice(0, 5).map((charge: any) => (
                          <tr key={charge.id}>
                            <td className="px-4 py-2 text-sm text-gray-900">
                              {charge.description}
                            </td>
                            <td className="px-4 py-2 text-sm text-gray-900">
                              {charge.quantity}
                            </td>
                            <td className="px-4 py-2 text-sm font-medium text-gray-900">
                              {statement.currency} {charge.totalAmount.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {group.charges.length > 5 && (
                      <div className="px-4 py-2 text-sm text-gray-500">
                        ... and {group.charges.length - 5} more charges
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Tabs.Content>

        <Tabs.Content value="details">
          <div className="space-y-4">
            <h3 className="font-semibold">Statement Details</h3>
            <div className="bg-gray-50 p-4 rounded">
              <dl className="space-y-2">
                <div className="flex justify-between">
                  <dt className="text-gray-600">Statement ID:</dt>
                  <dd className="font-mono text-sm">{statement.id}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-600">Statement Number:</dt>
                  <dd>{statement.statementNumber}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-600">Period:</dt>
                  <dd>
                    {new Date(statement.periodStart).toLocaleDateString()} - 
                    {new Date(statement.periodEnd).toLocaleDateString()}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-600">Currency:</dt>
                  <dd>{statement.currency}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-600">Total Charges:</dt>
                  <dd>{statement.charges.length}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-600">Total Amount:</dt>
                  <dd className="font-semibold">
                    {statement.currency} {statement.totalAmount.toLocaleString()}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="mt-6">
              <h3 className="font-semibold mb-2">Raw Data</h3>
              <div className="bg-gray-50 p-4 rounded font-mono text-sm overflow-auto">
                <pre>{JSON.stringify(statement, null, 2)}</pre>
              </div>
            </div>
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
};