import React from 'react';
import { Badge, Button, DataTable, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

type Row = {
  name: string;
  plan: string;
  status: 'Active' | 'Paused' | 'Trial';
  users: number;
  mrr: string;
  region: string;
  owner: string;
  renewal: string;
};

const data: Row[] = [
  { name: 'Acme Corp', plan: 'Growth', status: 'Active', users: 42, mrr: '$1,240', region: 'US West', owner: 'Alice', renewal: 'Jan 2026' },
  { name: 'Northwind', plan: 'Starter', status: 'Trial', users: 8, mrr: '$180', region: 'EU', owner: 'Bob', renewal: 'Mar 2026' },
  { name: 'Globex', plan: 'Scale', status: 'Paused', users: 130, mrr: '$3,980', region: 'APAC', owner: 'Carol', renewal: 'Feb 2026' },
  { name: 'Initech', plan: 'Growth', status: 'Active', users: 64, mrr: '$1,990', region: 'US East', owner: 'Dave', renewal: 'Apr 2026' },
  { name: 'Umbrella', plan: 'Starter', status: 'Trial', users: 12, mrr: '$240', region: 'EU', owner: 'Eve', renewal: 'Jun 2026' },
  { name: 'Stark Industries', plan: 'Scale', status: 'Active', users: 210, mrr: '$6,400', region: 'US West', owner: 'Frank', renewal: 'May 2026' },
  { name: 'Wayne Enterprises', plan: 'Growth', status: 'Paused', users: 88, mrr: '$2,720', region: 'US East', owner: 'Grace', renewal: 'Jul 2026' },
  { name: 'Oscorp', plan: 'Starter', status: 'Active', users: 16, mrr: '$360', region: 'APAC', owner: 'Hank', renewal: 'Aug 2026' },
  { name: 'Wonka', plan: 'Growth', status: 'Active', users: 52, mrr: '$1,540', region: 'EU', owner: 'Iris', renewal: 'Sep 2026' },
  { name: 'Hooli', plan: 'Scale', status: 'Paused', users: 140, mrr: '$4,120', region: 'US West', owner: 'Jack', renewal: 'Oct 2026' },
  { name: 'Soylent', plan: 'Starter', status: 'Trial', users: 6, mrr: '$120', region: 'APAC', owner: 'Kim', renewal: 'Nov 2026' },
  { name: 'Vehement Capital', plan: 'Growth', status: 'Active', users: 36, mrr: '$980', region: 'US East', owner: 'Leo', renewal: 'Dec 2026' },
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
  { key: 'region', header: 'Region', priority: 6 },
  { key: 'owner', header: 'Owner', priority: 7 },
  { key: 'renewal', header: 'Renewal', priority: 8 },
  {
    key: 'actions',
    header: 'Actions',
    priority: 9,
    render: () => <Button size="sm" variant="ghost">View</Button>,
  },
];

export function DataTableDemo() {
  const [visibleColumns, setVisibleColumns] = React.useState<string[]>([]);

  return (
    <DemoSection title="DataTable" description="Sortable, paginated table with responsive column hiding and custom cells. Resize the window to see lower-priority columns hide automatically.">
      <Stack gap={12}>
        <Text tone="muted">Visible columns: {visibleColumns.join(', ') || 'All'}</Text>
        <DataTable<Row>
          columns={columns}
          data={data}
          paginate
          defaultPageSize={5}
          initialSortKey="name"
          responsiveColumns
          minColumnWidth={100}
          onVisibleColumnsChange={setVisibleColumns}
        />
      </Stack>
    </DemoSection>
  );
}
