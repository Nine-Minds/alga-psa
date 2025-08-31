import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Agreement } from '../types';
import { dummyAgreements } from '../data/dummyAgreements';
import { Button, Card, Stack, Text, Badge, DataTable } from '@alga/ui-kit';

export const AgreementsList: React.FC = () => {
  const navigate = useNavigate();
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [filter, setFilter] = useState<Agreement['status'] | 'all'>('all');

  const agreements = useMemo(() => {
    return filter === 'all' ? dummyAgreements : dummyAgreements.filter(a => a.status === filter);
  }, [filter]);

  // Navigate to agreement detail
  const handleRowClick = (row: Agreement) => {
    navigate(`/agreement/${row.id}`);
  };

  // Handle row selection
  const handleRowSelection = (id: string) => {
    setSelectedRows(prev => {
      if (prev.includes(id)) {
        return prev.filter(rowId => rowId !== id);
      }
      return [...prev, id];
    });
  };

  const handleSelectAll = () => {
    if (selectedRows.length === agreements?.length) {
      setSelectedRows([]);
    } else {
      setSelectedRows(agreements?.map(a => a.id) || []);
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <Stack direction="row" justify="space-between" align="center" style={{ marginBottom: 12 }}>
        <Text as="h1" size="lg" weight={700}>SoftwareOne Agreements</Text>
        <Stack direction="row" gap={8}>
          <Button variant="secondary" onClick={() => navigate('/settings')}>Settings</Button>
        </Stack>
      </Stack>

      <Stack direction="row" gap={8} style={{ marginBottom: 8 }}>
        {(['all','active','inactive','pending','expired'] as const).map(key => (
          <Button key={key} variant={filter===key? 'primary':'secondary'} size="sm" onClick={() => setFilter(key as any)}>
            {key[0].toUpperCase() + key.slice(1)}
          </Button>
        ))}
      </Stack>

      {agreements.length === 0 ? (
        <Card>
          <Text>No agreements found.</Text>
        </Card>
      ) : (
        <Card>
          <DataTable
            data={agreements}
            columns={[
              { key: 'name', header: 'Agreement', sortable: true, render: (r) => (
                <button onClick={() => navigate(`/agreement/${r.id}`)} style={{ color: 'var(--alga-primary)', background: 'transparent', border: 0, cursor: 'pointer' }}>
                  {r.name}
                </button>
              ) },
              { key: 'product', header: 'Product', sortable: true },
              { key: 'vendor', header: 'Vendor', sortable: true },
              { key: 'consumer', header: 'Consumer' },
              { key: 'currency', header: 'Currency' },
              { key: 'status', header: 'Status', render: (r) => <Badge tone={r.status==='active'?'success': r.status==='pending' ? 'warning' : 'default'}>{r.status}</Badge> },
              { key: 'operations', header: 'Visibility' },
              { key: 'marginRpxy', header: 'Margin %' },
            ]}
            initialSortKey="name"
          />
        </Card>
      )}
    </div>
  );
};
