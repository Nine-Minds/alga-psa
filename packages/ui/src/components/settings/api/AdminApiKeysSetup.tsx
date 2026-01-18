'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import type { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { adminListApiKeys, adminDeactivateApiKey } from 'server/src/lib/actions/apiKeyActions';

export interface AdminApiKey {
  api_key_id: string;
  description: string | null;
  username: string;
  created_at: Date;
  last_used_at: Date | null;
  expires_at: Date | null;
  active: boolean;
}

export default function AdminApiKeysSetup() {
  const [apiKeys, setApiKeys] = useState<AdminApiKey[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  useEffect(() => {
    loadApiKeys();
  }, []);

  const loadApiKeys = async () => {
    try {
      const keysRaw = await adminListApiKeys();
      // Map string date fields to Date objects
      const formattedKeys = keysRaw.map((key: any) => ({
        ...key,
        created_at: new Date(key.created_at),
        last_used_at: key.last_used_at ? new Date(key.last_used_at) : null,
        expires_at: key.expires_at ? new Date(key.expires_at) : null,
      }));
      setApiKeys(formattedKeys);
      setError(null);
    } catch (error) {
      console.error('Failed to load API keys:', error);
      setError('Failed to load API keys. Please ensure you have admin privileges.');
    }
  };

  const handleDeactivateKey = async (keyId: string) => {
    try {
      await adminDeactivateApiKey(keyId);
      await loadApiKeys();
      setError(null);
    } catch (error) {
      console.error('Failed to deactivate API key:', error);
      setError('Failed to deactivate API key. Please ensure you have admin privileges.');
    }
  };

  const columns: ColumnDefinition<AdminApiKey>[] = useMemo(() => [
    {
      title: 'User',
      dataIndex: 'username',
      width: '15%',
    },
    {
      title: 'Description',
      dataIndex: 'description',
      width: '20%',
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      width: '15%',
      render: (value: Date) => new Date(value).toLocaleString(),
    },
    {
      title: 'Last Used',
      dataIndex: 'last_used_at',
      width: '15%',
      render: (value: Date | null) => value ? new Date(value).toLocaleString() : 'Never',
    },
    {
      title: 'Expires',
      dataIndex: 'expires_at',
      width: '15%',
      render: (value: Date | null) => value ? new Date(value).toLocaleString() : 'Never',
    },
    {
      title: 'Status',
      dataIndex: 'active',
      width: '10%',
      render: (value: boolean) => (
        <span className={`px-2 py-1 rounded text-sm ${value ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          {value ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      title: 'Actions',
      dataIndex: 'actions',
      width: '10%',
      render: (_: any, record: AdminApiKey) => (
        record.active ? (
          <Button
            id={`admin-deactivate-api-key-${record.api_key_id}`}
            variant="destructive"
            onClick={() => handleDeactivateKey(record.api_key_id)}
            className="text-sm"
          >
            Deactivate
          </Button>
        ) : null
      ),
    }
  ], [handleDeactivateKey]);

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="text-2xl font-semibold mb-4">API Keys Administration</h2>
        {error && (
          <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-md">
            {error}
          </div>
        )}
        <DataTable
          id="admin-api-keys-table"
          data={apiKeys}
          columns={columns}
          pagination={true}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          pageSize={pageSize}
          onItemsPerPageChange={handlePageSizeChange}
        />
      </Card>
    </div>
  );
}