import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as Tabs from '@radix-ui/react-tabs';
import { ExtensionContext, Agreement, Subscription, Order } from '../types';
import { useSwoneQuery } from '../hooks/useSwoneQuery';
import { SyncService } from '../services/syncService';

interface AgreementDetailProps {
  context: ExtensionContext;
}

// Simple Dialog component replacement
const Dialog: React.FC<{
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ open, onClose, children }) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4">
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
          onClick={onClose}
        />
        <div className="relative bg-white rounded-lg max-w-md w-full shadow-xl">
          {children}
        </div>
      </div>
    </div>
  );
};

export const AgreementDetail: React.FC<AgreementDetailProps> = ({ context }) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { storage, logger, api } = context;
  
  const [activeTab, setActiveTab] = useState('overview');
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showActivateDialog, setShowActivateDialog] = useState(false);

  // Fetch agreement details
  const { data: agreement, isLoading, error, refetch } = useSwoneQuery<Agreement | null>(
    ['agreement', id || ''],
    async () => {
      if (!id) return null;
      const namespace = storage.getNamespace('swone');
      const byId = await namespace.get('agreements/byId') || {};
      return byId[id] || null;
    }
  );

  // Fetch subscriptions
  const { data: subscriptions } = useSwoneQuery<Subscription[]>(
    ['subscriptions', id || ''],
    async () => {
      if (!id) return [];
      const namespace = storage.getNamespace('swone');
      return await namespace.get(`subscriptions/agreement/${id}`) || [];
    },
    { enabled: !!id }
  );

  // Fetch orders
  const { data: orders } = useSwoneQuery<Order[]>(
    ['orders', id || ''],
    async () => {
      if (!id) return [];
      const namespace = storage.getNamespace('swone');
      return await namespace.get(`orders/agreement/${id}`) || [];
    },
    { enabled: !!id }
  );

  // Fetch consumer details (company mapping)
  const { data: company } = useSwoneQuery(
    ['company', agreement?.consumer || ''],
    async () => {
      if (!agreement?.consumer) return null;
      
      try {
        // Try to find mapped company
        const companies = await api.call('GET', '/companies');
        return companies.find((c: any) => c.external_id === agreement.consumer) || null;
      } catch {
        return null;
      }
    },
    { enabled: !!agreement?.consumer }
  );

  // Handle activation
  const handleActivate = async () => {
    try {
      const response = await api.call('POST', `/api/extensions/com.alga.softwareone/activate-agreement`, {
        agreementId: id
      });
      
      if (response.success) {
        // Refresh agreement data
        const config = await storage.getNamespace('swone').get('config');
        const syncService = new SyncService(config, context);
        if (id) await syncService.refreshAgreement(id);
        
        refetch();
        setShowActivateDialog(false);
      }
    } catch (error) {
      logger.error('Failed to activate agreement', error);
    }
  };

  if (isLoading) {
    return <div className="p-6">Loading agreement details...</div>;
  }

  if (error || !agreement) {
    return (
      <div className="p-6">
        <div className="p-4 rounded-md bg-red-50 text-red-800 border border-red-200">
          Failed to load agreement details
        </div>
        <button 
          onClick={() => navigate('/softwareone/agreements')} 
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Back to Agreements
        </button>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-start mb-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => navigate('/softwareone/agreements')}
              className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
            >
              ← Back
            </button>
          </div>
          <h1 className="text-2xl font-bold">{agreement.name}</h1>
          <p className="text-gray-600">{agreement.product} • {agreement.vendor}</p>
        </div>
        
        <div className="flex gap-3">
          {agreement.status !== 'active' && (
            <button 
              onClick={() => setShowActivateDialog(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Activate Agreement
            </button>
          )}
          <button 
            onClick={() => setShowEditDialog(true)}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300"
          >
            Edit
          </button>
        </div>
      </div>

      <Tabs.Root value={activeTab} onValueChange={setActiveTab} className="w-full">
        <Tabs.List className="flex border-b mb-6">
          <Tabs.Trigger value="overview" className="px-4 py-2 hover:bg-gray-50 data-[state=active]:border-b-2 data-[state=active]:border-blue-500">
            SoftwareOne
          </Tabs.Trigger>
          <Tabs.Trigger value="subscriptions" className="px-4 py-2 hover:bg-gray-50 data-[state=active]:border-b-2 data-[state=active]:border-blue-500">
            Subscriptions ({subscriptions?.length || 0})
          </Tabs.Trigger>
          <Tabs.Trigger value="orders" className="px-4 py-2 hover:bg-gray-50 data-[state=active]:border-b-2 data-[state=active]:border-blue-500">
            Orders ({orders?.length || 0})
          </Tabs.Trigger>
          <Tabs.Trigger value="consumer" className="px-4 py-2 hover:bg-gray-50 data-[state=active]:border-b-2 data-[state=active]:border-blue-500">
            Consumer
          </Tabs.Trigger>
          <Tabs.Trigger value="billing" className="px-4 py-2 hover:bg-gray-50 data-[state=active]:border-b-2 data-[state=active]:border-blue-500">
            Billing
          </Tabs.Trigger>
          <Tabs.Trigger value="details" className="px-4 py-2 hover:bg-gray-50 data-[state=active]:border-b-2 data-[state=active]:border-blue-500">
            Details
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="overview">
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold mb-2">Agreement Information</h3>
                <dl className="space-y-2">
                  <div className="flex justify-between">
                    <dt className="text-gray-600">Agreement ID:</dt>
                    <dd className="font-mono text-sm">{agreement.id}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-600">Status:</dt>
                    <dd>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        agreement.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                      }`}>
                        {agreement.status}
                      </span>
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-600">Currency:</dt>
                    <dd>{agreement.currency}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-600">SPx Year:</dt>
                    <dd>{agreement.spxYear}</dd>
                  </div>
                </dl>
              </div>

              <div>
                <h3 className="font-semibold mb-2">Billing Configuration</h3>
                <dl className="space-y-2">
                  <div className="flex justify-between">
                    <dt className="text-gray-600">Billing Config ID:</dt>
                    <dd className="font-mono text-sm">{agreement.billingConfigId}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-600">Margin RPxy:</dt>
                    <dd>{agreement.marginRpxy}%</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-600">Operations:</dt>
                    <dd>{agreement.operations}</dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="font-semibold mb-2">Local Configuration</h3>
                {agreement.localConfig ? (
                  <dl className="space-y-2">
                    <div className="flex justify-between">
                      <dt className="text-gray-600">Markup:</dt>
                      <dd>{agreement.localConfig.markup || 0}%</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-gray-600">Tags:</dt>
                      <dd>
                        {agreement.localConfig.tags?.map(tag => (
                          <span key={tag} className="inline-block px-2 py-1 mr-1 text-xs bg-gray-100 rounded">
                            {tag}
                          </span>
                        )) || 'None'}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-gray-500 text-sm">No local configuration set</p>
                )}
              </div>

              <div>
                <h3 className="font-semibold mb-2">Notes</h3>
                <p className="text-sm text-gray-600">
                  {agreement.localConfig?.notes || 'No notes added'}
                </p>
              </div>
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="subscriptions">
          <div className="bg-white rounded-lg shadow">
            {subscriptions && subscriptions.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Subscription Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Quantity
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Unit Price
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Start Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        End Date
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {subscriptions.map((subscription) => (
                      <tr key={subscription.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {subscription.name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {subscription.quantity}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {agreement.currency} {subscription.unitPrice}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {subscription.status}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {subscription.startDate}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {subscription.endDate}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center text-gray-500">
                No subscriptions found for this agreement
              </div>
            )}
          </div>
        </Tabs.Content>

        <Tabs.Content value="orders">
          <div className="bg-white rounded-lg shadow">
            {orders && orders.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Order Number
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Order Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Total Amount
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Items
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {orders.map((order) => (
                      <tr key={order.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {order.orderNumber}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {order.orderDate}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {agreement.currency} {order.totalAmount}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {order.status}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {order.items?.length || 0} items
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center text-gray-500">
                No orders found for this agreement
              </div>
            )}
          </div>
        </Tabs.Content>

        <Tabs.Content value="consumer">
          <div className="space-y-4">
            <h3 className="font-semibold">Consumer Information</h3>
            <div className="bg-gray-50 p-4 rounded">
              <dl className="space-y-2">
                <div className="flex justify-between">
                  <dt className="text-gray-600">Consumer ID:</dt>
                  <dd className="font-mono text-sm">{agreement.consumer}</dd>
                </div>
                {company ? (
                  <>
                    <div className="flex justify-between">
                      <dt className="text-gray-600">Mapped Company:</dt>
                      <dd>{company.name}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-gray-600">Company Type:</dt>
                      <dd>{company.type}</dd>
                    </div>
                  </>
                ) : (
                  <div className="mt-4">
                    <div className="p-4 rounded-md bg-yellow-50 text-yellow-800 border border-yellow-200">
                      This consumer is not mapped to any company in Alga PSA.
                      You may need to create or link a company for billing purposes.
                    </div>
                  </div>
                )}
              </dl>
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="billing">
          <div className="space-y-4">
            <h3 className="font-semibold">Billing Configuration</h3>
            <div className="p-4 rounded-md bg-blue-50 text-blue-800 border border-blue-200">
              Billing integration features will be available in the next version.
              This will allow you to:
              <ul className="list-disc list-inside mt-2">
                <li>Map agreement charges to Alga invoices</li>
                <li>Configure automated billing rules</li>
                <li>Set up markup percentages</li>
                <li>Generate billing reports</li>
              </ul>
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="details">
          <div className="space-y-4">
            <h3 className="font-semibold">Technical Details</h3>
            <div className="bg-gray-50 p-4 rounded font-mono text-sm">
              <pre>{JSON.stringify(agreement, null, 2)}</pre>
            </div>
          </div>
        </Tabs.Content>
      </Tabs.Root>

      {/* Activation Dialog */}
      <Dialog open={showActivateDialog} onClose={() => setShowActivateDialog(false)}>
        <div className="p-6">
          <h2 className="text-lg font-semibold mb-4">Activate Agreement</h2>
          <p className="mb-6">
            Are you sure you want to activate this agreement? This will update the status
            in SoftwareOne and enable billing features.
          </p>
          <div className="flex justify-end gap-3">
            <button 
              onClick={() => setShowActivateDialog(false)}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300"
            >
              Cancel
            </button>
            <button 
              onClick={handleActivate}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Activate
            </button>
          </div>
        </div>
      </Dialog>

      {/* Edit Dialog - Placeholder */}
      <Dialog open={showEditDialog} onClose={() => setShowEditDialog(false)}>
        <div className="p-6">
          <h2 className="text-lg font-semibold mb-4">Edit Agreement Configuration</h2>
          <div className="p-4 rounded-md bg-blue-50 text-blue-800 border border-blue-200">
            Edit functionality will be implemented in the next phase.
          </div>
          <div className="flex justify-end mt-6">
            <button 
              onClick={() => setShowEditDialog(false)}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300"
            >
              Close
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};