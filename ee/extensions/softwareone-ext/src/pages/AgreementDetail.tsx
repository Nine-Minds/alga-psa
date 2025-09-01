import React, { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as Tabs from '@radix-ui/react-tabs';
import { Agreement } from '../types';
import { dummyAgreements, dummyOrdersByAgreement, dummySubscriptionsByAgreement } from '../data/dummyAgreements';
import { Button, Card, Stack, Text, Badge, DataTable } from '@alga/ui-kit';

// Simple Dialog component replacement for this demo
const Dialog: React.FC<{ open: boolean; onClose: () => void; children: React.ReactNode }>
  = ({ open, onClose, children }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4">
        <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
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
          <Button variant="secondary" onClick={() => navigate('/agreements')} style={{ marginTop: 8 }}>
            Back to Agreements
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <Stack direction="row" justify="space-between" align="center" style={{ marginBottom: 12 }}>
        <Stack>
          <Button variant="secondary" size="sm" onClick={() => navigate('/agreements')}>← Back</Button>
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
          <Tabs.Trigger value="overview" className="px-4 py-2 hover:bg-gray-50 data-[state=active]:border-b-2 data-[state=active]:border-blue-500">SoftwareOne</Tabs.Trigger>
          <Tabs.Trigger value="subscriptions" className="px-4 py-2 hover:bg-gray-50 data-[state=active]:border-b-2 data-[state=active]:border-blue-500">Subscriptions ({subscriptions?.length || 0})</Tabs.Trigger>
          <Tabs.Trigger value="orders" className="px-4 py-2 hover:bg-gray-50 data-[state=active]:border-b-2 data-[state=active]:border-blue-500">Orders ({orders?.length || 0})</Tabs.Trigger>
          <Tabs.Trigger value="consumer" className="px-4 py-2 hover:bg-gray-50 data-[state=active]:border-b-2 data-[state=active]:border-blue-500">Consumer</Tabs.Trigger>
          <Tabs.Trigger value="billing" className="px-4 py-2 hover:bg-gray-50 data-[state=active]:border-b-2 data-[state=active]:border-blue-500">Billing</Tabs.Trigger>
          <Tabs.Trigger value="details" className="px-4 py-2 hover:bg-gray-50 data-[state=active]:border-b-2 data-[state=active]:border-blue-500">Details</Tabs.Trigger>
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

        <Tabs.Content value="consumer">
          <Card>
            <Text tone="muted">No consumer mapping available in demo data.</Text>
          </Card>
        </Tabs.Content>

        <Tabs.Content value="billing">
          <Card>
            <Text tone="muted">Billing configuration editing is not implemented in this demo.</Text>
          </Card>
        </Tabs.Content>

        <Tabs.Content value="details">
          <Card>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(agreement, null, 2)}</pre>
          </Card>
        </Tabs.Content>
      </Tabs.Root>

      {/* Edit Dialog Placeholder */}
      <Dialog open={showEditDialog} onClose={() => setShowEditDialog(false)}>
        <div className="p-4 space-y-4">
          <Text as="h3" weight={600}>Edit Agreement</Text>
          <Text tone="muted">Editing is not implemented in this demo.</Text>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowEditDialog(false)}>Close</Button>
          </div>
        </div>
      </Dialog>

      {/* Activate Dialog Placeholder */}
      <Dialog open={showActivateDialog} onClose={() => setShowActivateDialog(false)}>
        <div className="p-4 space-y-4">
          <Text as="h3" weight={600}>Activate Agreement</Text>
          <Text>Are you sure you want to activate this agreement?</Text>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowActivateDialog(false)}>Cancel</Button>
            <Button onClick={handleActivate}>Activate</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
