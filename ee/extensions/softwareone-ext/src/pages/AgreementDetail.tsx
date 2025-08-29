import React, { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as Tabs from '@radix-ui/react-tabs';
import { Agreement } from '../types';
import { dummyAgreements, dummyOrdersByAgreement, dummySubscriptionsByAgreement } from '../data/dummyAgreements';
import { Button, Card, Stack, Text, Badge, DataTable } from '@alga/ui-kit';

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

export const AgreementDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showActivateDialog, setShowActivateDialog] = useState(false);

  const agreement: Agreement | null = useMemo(() => dummyAgreements.find(a => a.id === id) || null, [id]);
  const subscriptions = useMemo(() => (id ? (dummySubscriptionsByAgreement[id] || []) : []), [id]);
  const orders = useMemo(() => (id ? (dummyOrdersByAgreement[id] || []) : []), [id]);

  const handleActivate = () => setShowActivateDialog(false);

  if (!agreement) {
    return (
      <div style={{ padding: 16 }}>
        <Card>
          <Text>Agreement not found.</Text>
          <Button variant="secondary" onClick={() => navigate('/softwareone/agreements')} style={{ marginTop: 8 }}>Back to Agreements</Button>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <Stack direction="row" justify="space-between" align="center" style={{ marginBottom: 12 }}>
        <Stack>
          <Button variant="secondary" size="sm" onClick={() => navigate('/softwareone/agreements')}>← Back</Button>
          <Text as="h1" size="lg" weight={700}>{agreement.name}</Text>
          <Text tone="muted">{agreement.product} • {agreement.vendor}</Text>
        </Stack>
        <Stack direction="row" gap={8}>
          {agreement.status !== 'active' && (
            <Button onClick={() => setShowActivateDialog(true)}>Activate Agreement</Button>
          )}
          <Button variant="secondary" onClick={() => setShowEditDialog(true)}>Edit</Button>
        </Stack>
      </Stack>

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
          <Stack direction="row" gap={16}>
            <Card style={{ flex: 1 }}>
              <Stack gap={8}>
                <Text as="h3" weight={600}>Agreement Information</Text>
                <Stack>
                  <Text>Agreement ID: <code>{agreement.id}</code></Text>
                  <Text>Status: <Badge tone={agreement.status==='active'?'success':'default'}>{agreement.status}</Badge></Text>
                  <Text>Currency: {agreement.currency}</Text>
                  <Text>SPx Year: {agreement.spxYear}</Text>
                </Stack>
              </Stack>
            </Card>
            <Card style={{ flex: 1 }}>
              <Stack gap={8}>
                <Text as="h3" weight={600}>Billing Configuration</Text>
                <Stack>
                  <Text>Billing Config ID: <code>{agreement.billingConfigId}</code></Text>
                  <Text>Margin RPxy: {agreement.marginRpxy}%</Text>
                  <Text>Operations: {agreement.operations}</Text>
                </Stack>
              </Stack>
            </Card>
          </Stack>
        </Tabs.Content>

        <Tabs.Content value="subscriptions">
          <Card>
            {subscriptions.length > 0 ? (
              <DataTable
                data={subscriptions}
                columns={[
                  { key: 'name', header: 'Subscription', sortable: true },
                  { key: 'quantity', header: 'Qty' },
                  { key: 'unitPrice', header: 'Unit Price', render: (r) => `${agreement.currency} ${r.unitPrice}` },
                  { key: 'status', header: 'Status' },
                  { key: 'startDate', header: 'Start' },
                  { key: 'endDate', header: 'End' },
                ]}
                initialSortKey="name"
              />
            ) : (
              <Text tone="muted">No subscriptions found for this agreement</Text>
            )}
          </Card>
        </Tabs.Content>

        <Tabs.Content value="orders">
          <Card>
            {orders.length > 0 ? (
              <DataTable
                data={orders}
                columns={[
                  { key: 'orderNumber', header: 'Order Number', sortable: true },
                  { key: 'orderDate', header: 'Order Date' },
                  { key: 'totalAmount', header: 'Total', render: (r) => `${agreement.currency} ${r.totalAmount}` },
                  { key: 'status', header: 'Status' },
                  { key: 'items', header: 'Items', render: (r) => `${r.items?.length || 0} items` },
                ]}
                initialSortKey="orderNumber"
              />
            ) : (
              <Text tone="muted">No orders found for this agreement</Text>
            )}
          </Card>
        </Tabs.Content>
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
          <p className="mb-6">This is a demo-only activation.</p>
          <div className="flex justify-end gap-3">
            <button onClick={() => setShowActivateDialog(false)} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">Cancel</button>
            <button onClick={handleActivate} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">Activate</button>
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
