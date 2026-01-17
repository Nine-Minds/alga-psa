'use client';

import { Asset } from 'server/src/interfaces/asset.interfaces';
import { useState } from 'react';
import { AssetDetails } from './AssetDetails';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';

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
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
          value === 'active' ? 'bg-green-100 text-green-800' :
          value === 'inactive' ? 'bg-gray-100 text-gray-800' :
          'bg-yellow-100 text-yellow-800'
        }`}>
          {value}
        </span>
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
