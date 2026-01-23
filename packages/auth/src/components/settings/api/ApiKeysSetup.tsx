'use client';

// Auth-owned API key management UI.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import type { ColumnDefinition } from '@alga-psa/types';
import { createApiKey, deactivateApiKey, listApiKeys } from '@alga-psa/auth/actions';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';

export interface ApiKey {
  api_key_id: string;
  description: string | null;
  created_at: Date;
  last_used_at: Date | null;
  expires_at: Date | null;
  active: boolean;
}

export default function ApiKeysSetup() {
  const [description, setDescription] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [showNewKeyDialog, setShowNewKeyDialog] = useState(false);
  const [newKeyValue, setNewKeyValue] = useState('');
  const router = useRouter();

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  const loadApiKeys = useCallback(async () => {
    try {
      const keysRaw = await listApiKeys();
      // Map string date fields to Date objects.
      const formattedKeys = keysRaw.map((key: any) => ({
        ...key,
        created_at: new Date(key.created_at),
        last_used_at: key.last_used_at ? new Date(key.last_used_at) : null,
        expires_at: key.expires_at ? new Date(key.expires_at) : null,
      }));
      setApiKeys(formattedKeys);
    } catch (error) {
      console.error('Failed to load API keys:', error);
    }
  }, []);

  useEffect(() => {
    loadApiKeys();
  }, [loadApiKeys]);

  const handleCreateKey = async () => {
    try {
      const result = await createApiKey(
        description,
        expirationDate ? new Date(expirationDate).toISOString() : undefined
      );
      setNewKeyValue(result.api_key);
      setShowNewKeyDialog(true);
      setDescription('');
      setExpirationDate('');
      await loadApiKeys();
    } catch (error) {
      console.error('Failed to create API key:', error);
    }
  };

  const handleDeactivateKey = useCallback(async (keyId: string) => {
    try {
      await deactivateApiKey(keyId);
      await loadApiKeys();
    } catch (error) {
      console.error('Failed to deactivate API key:', error);
    }
  }, [loadApiKeys]);

  const columns: ColumnDefinition<ApiKey>[] = useMemo(() => [
    {
      title: 'Description',
      dataIndex: 'description',
      width: '20%',
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      width: '20%',
      render: (value: Date) => new Date(value).toLocaleString(),
    },
    {
      title: 'Last Used',
      dataIndex: 'last_used_at',
      width: '20%',
      render: (value: Date | null) => value ? new Date(value).toLocaleString() : 'Never',
    },
    {
      title: 'Expires',
      dataIndex: 'expires_at',
      width: '20%',
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
      render: (_: any, record: ApiKey) => (
        record.active ? (
          <Button
            id={`deactivate-api-key-${record.api_key_id}`}
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
        <h2 className="text-2xl font-semibold mb-4">Generate API Key</h2>
        <div className="space-y-4 mb-6">
          <div>
            <Label htmlFor="api-key-description">Description</Label>
            <Input
              id="api-key-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Development API Key"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="api-key-expiration">Expiration Date (Optional)</Label>
            <Input
              id="api-key-expiration"
              type="datetime-local"
              value={expirationDate}
              onChange={(e) => setExpirationDate(e.target.value)}
              className="mt-1"
            />
          </div>
          <Button
            id="generate-api-key-button"
            onClick={handleCreateKey}
            disabled={!description}
          >
            Generate New API Key
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-2xl font-semibold mb-4">Your API Keys</h2>
        <DataTable
          id="api-keys-table"
          data={apiKeys}
          columns={columns}
          pagination={true}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          pageSize={pageSize}
          onItemsPerPageChange={handlePageSizeChange}
        />
      </Card>

      <Dialog 
        isOpen={showNewKeyDialog} 
        onClose={() => setShowNewKeyDialog(false)} 
        title="API Key Generated"
      >
        <DialogContent>
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Please copy your API key now. For security reasons, it will not be shown again.
            </p>
            <div className="p-4 bg-gray-50 rounded-md">
              <code className="text-sm break-all">{newKeyValue}</code>
            </div>
            <Button
              id="copy-api-key-button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(newKeyValue);
                  toast.success('API key copied to clipboard!');
                } catch (error) {
                  toast.error('Failed to copy API key to clipboard');
                }
              }}
              className="w-full"
            >
              Copy to Clipboard
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
