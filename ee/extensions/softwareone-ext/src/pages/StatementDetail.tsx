import React, { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as Tabs from '@radix-ui/react-tabs';
import { dummyStatements, dummyCharges } from '../data/dummyStatements';
import { Button, Card, Stack, Text, DataTable } from '@alga/ui-kit';

export const StatementDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('charges');

  const statement = useMemo(() => dummyStatements.find(s => s.id === id) || null, [id]);
  const charges = useMemo(() => (id ? (dummyCharges[id] || []) : []), [id]);

  if (!statement) {
    return (
      <div style={{ padding: 16 }}>
        <Card>
          <Text>Statement not found.</Text>
          <Button variant="secondary" onClick={() => navigate('/softwareone/statements')} style={{ marginTop: 8 }}>Back to Statements</Button>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <Stack direction="row" justify="space-between" align="center" style={{ marginBottom: 12 }}>
        <Stack>
          <Button variant="secondary" size="sm" onClick={() => navigate('/softwareone/statements')}>← Back</Button>
          <Text as="h1" size="lg" weight={700}>Statement {statement.statementNumber}</Text>
          <Text tone="muted">{new Date(statement.periodStart).toLocaleDateString()} - {new Date(statement.periodEnd).toLocaleDateString()}</Text>
        </Stack>
        <Stack>
          {statement.status === 'final' && (
            <Button onClick={() => alert('Demo: Create invoice from charges')}>Create Invoice</Button>
          )}
        </Stack>
      </Stack>

      <Stack direction="row" gap={16} style={{ marginBottom: 12 }}>
        <Card style={{ flex: 1 }}>
          <Text size="sm" tone="muted">Total Amount</Text>
          <Text as="strong" size="lg">{statement.currency} {statement.totalAmount.toLocaleString()}</Text>
        </Card>
        <Card style={{ flex: 1 }}>
          <Text size="sm" tone="muted">Status</Text>
          <Text as="strong">{statement.status}</Text>
        </Card>
        <Card style={{ flex: 1 }}>
          <Text size="sm" tone="muted">Charges</Text>
          <Text as="strong">{charges.length}</Text>
        </Card>
      </Stack>

      <Tabs.Root value={activeTab} onValueChange={setActiveTab} className="w-full">
        <Tabs.List className="flex border-b mb-6">
          <Tabs.Trigger value="charges" className="px-4 py-2 data-[state=active]:border-b-2 data-[state=active]:border-blue-500">Charges ({charges.length})</Tabs.Trigger>
          <Tabs.Trigger value="details" className="px-4 py-2 data-[state=active]:border-b-2 data-[state=active]:border-blue-500">Details</Tabs.Trigger>
        </Tabs.List>

      <Tabs.Content value="charges">
        <Card>
          <DataTable
            data={charges}
            columns={[
              { key: 'description', header: 'Description', sortable: true },
              { key: 'chargeDate', header: 'Date' },
              { key: 'quantity', header: 'Qty' },
              { key: 'unitPrice', header: 'Unit Price', render: (r) => `${statement.currency} ${r.unitPrice}` },
              { key: 'totalAmount', header: 'Total', render: (r) => `${statement.currency} ${r.totalAmount.toLocaleString()}` },
            ]}
            initialSortKey="description"
          />
        </Card>
      </Tabs.Content>

      <Tabs.Content value="details">
        <Card>
          <Text as="h3" weight={600}>Statement Details</Text>
          <div style={{ fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap' }}>{JSON.stringify(statement, null, 2)}</div>
        </Card>
      </Tabs.Content>
      </Tabs.Root>
    </div>
  );
};

