'use client';

import { Asset } from '@alga-psa/types';
import { useState } from 'react';
import { AssetDetails } from './AssetDetails';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Badge } from '@alga-psa/ui/components/Badge';
import { ColumnDefinition } from '@alga-psa/types';

interface AssetListProps {
  assets: Asset[];
}

export function AssetList({ assets }: AssetListProps) {
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  // Format date helper
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const columns: ColumnDefinition<Asset>[] = [
    {
      title: 'Name',
      dataIndex: 'name'
    },
    {
      title: 'Type',
      dataIndex: 'type_id'
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (value: string) => (
        <Badge variant={
          value === 'active' ? 'success' :
          value === 'inactive' ? 'default-muted' :
          'warning'
        }>
          {value}
        </Badge>
      )
    },
    {
      title: 'Location',
      dataIndex: 'location',
      render: (value: string | null) => value || 'N/A'
    },
    {
      title: 'Last Updated',
      dataIndex: 'updated_at',
      render: (value: string) => formatDate(value)
    }
  ];

  return (
    <div>
      <DataTable
        id="client-portal-assets"
        data={assets}
        columns={columns}
        pagination={true}
        onRowClick={setSelectedAsset}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        pageSize={10}
      />

      <Dialog
        isOpen={!!selectedAsset}
        onClose={() => setSelectedAsset(null)}
        title={selectedAsset?.name || 'Asset Details'}
      >
        {selectedAsset && <AssetDetails asset={selectedAsset} />}
      </Dialog>
    </div>
  );
}
