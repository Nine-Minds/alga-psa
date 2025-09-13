import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Statement } from '../types';
import { dummyStatements } from '../data/dummyStatements';
import { Button, Card, Stack, Text, DataTable } from '@alga/ui-kit';
import { DatePicker } from 'server/src/components/ui/DatePicker';
export const StatementsList: React.FC = () => {
  const navigate = useNavigate();
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [filter, setFilter] = useState<Statement['status'] | 'all'>('all');
  const [dateRange, setDateRange] = useState({
    from: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    to: new Date().toISOString().split('T')[0]
  });

  const statements = useMemo(() => {
    let list = [...dummyStatements];
    if (filter !== 'all') list = list.filter(s => s.status === filter);
    const from = new Date(dateRange.from), to = new Date(dateRange.to);
    list = list.filter(s => {
      const d = new Date(s.periodEnd);
      return d >= from && d <= to;
    });
    return list;
  }, [filter, dateRange]);

  const handleRowSelection = (id: string) => {
    setSelectedRows(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
  const handleSelectAll = () => {
    if (selectedRows.length === statements.length) setSelectedRows([]);
    else setSelectedRows(statements.map(s => s.id));
  };
  const handleBulkBilling = () => {
    if (selectedRows.length === 0) return;
    alert(`Demo: Billing ${selectedRows.length} statements`);
  };
  const handleRowClick = (row: Statement) => navigate(`/statement/${row.id}`);

  return (
    <div style={{ padding: 16 }}>
      <Stack direction="row" justify="space-between" align="center" style={{ marginBottom: 12 }}>
        <Text as="h1" size="lg" weight={700}>SoftwareOne Statements</Text>
        <Stack direction="row" gap={8}>
          {selectedRows.length > 0 && (
            <Button onClick={handleBulkBilling}>Bill Selected ({selectedRows.length})</Button>
          )}
          <Button variant="secondary" onClick={() => navigate('/agreements')}>View Agreements</Button>
        </Stack>
      </Stack>

      <Stack direction="row" gap={8} style={{ marginBottom: 8, flexWrap: 'wrap' as any }}>
        {(['all','draft','final','billed'] as const).map(key => (
          <Button key={key} variant={filter===key? 'primary':'secondary'} size="sm" onClick={() => setFilter(key as any)}>
            {key[0].toUpperCase() + key.slice(1)}
          </Button>
        ))}
        <Stack direction="row" gap={8}>
          <input type="date" value={dateRange.from} onChange={(e) => setDateRange(v => ({ ...v, from: e.target.value }))} />
          <input type="date" value={dateRange.to} onChange={(e) => setDateRange(v => ({ ...v, to: e.target.value }))} />
        </Stack>
      </Stack>

      <Card>
        <DataTable
          data={statements}
          columns={[
            { key: 'statementNumber', header: 'Statement #', sortable: true, render: (r) => (
              <button onClick={() => handleRowClick(r)} style={{ color: 'var(--alga-primary)', background: 'transparent', border: 0, cursor: 'pointer' }}>{r.statementNumber}</button>
            ) },
            { key: 'periodStart', header: 'Period Start', render: (r) => new Date(r.periodStart).toLocaleDateString() },
            { key: 'periodEnd', header: 'Period End', render: (r) => new Date(r.periodEnd).toLocaleDateString() },
            { key: 'totalAmount', header: 'Total Amount', render: (r) => `${r.currency} ${r.totalAmount.toLocaleString()}` },
            { key: 'charges', header: 'Charges', render: (r) => `${r.charges?.length || 0} items` },
            { key: 'status', header: 'Status' },
          ]}
          initialSortKey="statementNumber"
        />
      </Card>

      {selectedRows.length > 0 && (
        <Card style={{ marginTop: 8 }}>
          <Stack direction="row" justify="space-between" align="center">
            <Text size="sm">{selectedRows.length} statement{selectedRows.length > 1 ? 's' : ''} selected</Text>
            <Text size="sm" weight={600}>
              Total selected: {
                statements
                  .filter(s => selectedRows.includes(s.id))
                  .reduce((sum, s) => sum + s.totalAmount, 0)
                  .toLocaleString()
              } {statements[0]?.currency}
            </Text>
          </Stack>
        </Card>
      )}
    </div>
  );
};
