import React from 'react';
import { Badge, Button, DataTable, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

type Row = {
  name: string;
  plan: string;
  status: 'Active' | 'Paused' | 'Trial';
  users: number;
  mrr: string;
};

const data: Row[] = [
  { name: 'Acme Corp', plan: 'Growth', status: 'Active', users: 42, mrr: '$1,240' },
  { name: 'Northwind', plan: 'Starter', status: 'Trial', users: 8, mrr: '$180' },
  { name: 'Globex', plan: 'Scale', status: 'Paused', users: 130, mrr: '$3,980' },
  { name: 'Initech', plan: 'Growth', status: 'Active', users: 64, mrr: '$1,990' },
  { name: 'Umbrella', plan: 'Starter', status: 'Trial', users: 12, mrr: '$240' },
  { name: 'Stark Industries', plan: 'Scale', status: 'Active', users: 210, mrr: '$6,400' },
  { name: 'Wayne Enterprises', plan: 'Growth', status: 'Paused', users: 88, mrr: '$2,720' },
  { name: 'Oscorp', plan: 'Starter', status: 'Active', users: 16, mrr: '$360' },
  { name: 'Wonka', plan: 'Growth', status: 'Active', users: 52, mrr: '$1,540' },
  { name: 'Hooli', plan: 'Scale', status: 'Paused', users: 140, mrr: '$4,120' },
  { name: 'Soylent', plan: 'Starter', status: 'Trial', users: 6, mrr: '$120' },
  { name: 'Vehement Capital', plan: 'Growth', status: 'Active', users: 36, mrr: '$980' },
];

const columns = [
  { key: 'name', header: 'Company', sortable: true, alwaysShow: true },
  { key: 'plan', header: 'Plan', priority: 2 },
  {
    key: 'status',
    header: 'Status',
    priority: 3,
    render: (row: Row) => {
      const tone = row.status === 'Active' ? 'success' : row.status === 'Paused' ? 'warning' : 'info';
      return <Badge tone={tone}>{row.status}</Badge>;
    },
  },
  { key: 'users', header: 'Users', sortable: true, priority: 4 },
  { key: 'mrr', header: 'MRR', sortable: true, priority: 5 },
  {
    key: 'actions',
    header: 'Actions',
    render: () => <Button size="sm" variant="ghost">View</Button>,
  },
];

export function DataTableDemo() {
  const [visibleColumns, setVisibleColumns] = React.useState<string[]>([]);

  return (
    <DemoSection title="DataTable" description="Sortable, paginated table with responsive column hiding and custom cells.">
      <Stack gap={12}>
        <Text tone="muted">Visible columns: {visibleColumns.join(', ') || 'All'}</Text>
        <div style={{ maxWidth: 720 }}>
          <DataTable<Row>
            columns={columns}
            data={data}
            paginate
            defaultPageSize={5}
            initialSortKey="name"
            responsiveColumns
            minColumnWidth={140}
            onVisibleColumnsChange={setVisibleColumns}
          />
        </div>
      </Stack>
    </DemoSection>
  );
}
