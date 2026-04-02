'use client';

// Auth-owned API key management UI.

import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import type { ColumnDefinition } from '@alga-psa/types';
import { createApiKey, deactivateApiKey, listApiKeys } from '@alga-psa/auth/actions';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { Search, RotateCcw } from 'lucide-react';

export interface ApiKey {
  api_key_id: string;
  description: string | null;
  created_at: Date;
  last_used_at: Date | null;
  expires_at: Date | null;
  active: boolean;
}

const SearchInput = memo(({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
}) => (
  <div className="relative p-0.5">
    <Input
      id="search-api-keys"
      type="text"
      placeholder={placeholder}
      className="border-2 border-gray-200 focus:border-purple-500 rounded-md pl-10 pr-4 py-2 w-64 outline-none bg-white"
      value={value}
      onChange={onChange}
      preserveCursor={true}
    />
    <Search size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
  </div>
));
SearchInput.displayName = 'SearchInput';

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

  // Filter state
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('active');
  const [lastUsedAfter, setLastUsedAfter] = useState<Date | undefined>(undefined);
  const [expiresBeforeDate, setExpiresBeforeDate] = useState<Date | undefined>(undefined);

  const isFiltered = searchTerm !== '' || statusFilter !== 'active' || !!lastUsedAfter || !!expiresBeforeDate;

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchInput);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const handleSearchInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchInput(e.target.value);
  }, []);

  const handleResetFilters = useCallback(() => {
    setSearchInput('');
    setSearchTerm('');
    setStatusFilter('active');
    setLastUsedAfter(undefined);
    setExpiresBeforeDate(undefined);
    setCurrentPage(1);
  }, []);

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  // Filter keys client-side
  const filteredKeys = useMemo(() => {
    return apiKeys.filter((key) => {
      if (statusFilter === 'active' && !key.active) return false;
      if (statusFilter === 'inactive' && key.active) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        if (!key.description?.toLowerCase().includes(term)) return false;
      }
      if (lastUsedAfter) {
        if (!key.last_used_at || new Date(key.last_used_at) < lastUsedAfter) return false;
      }
      if (expiresBeforeDate) {
        if (!key.expires_at || new Date(key.expires_at) > expiresBeforeDate) return false;
      }
      return true;
    });
  }, [apiKeys, statusFilter, searchTerm, lastUsedAfter, expiresBeforeDate]);

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

  const handleDownloadKey = useCallback(() => {
    try {
      const blob = new Blob([newKeyValue], { type: 'text/plain;charset=utf-8' });
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = 'api-key.txt';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      handleError(error, 'Failed to download API key');
    }
  }, [newKeyValue]);

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
        <div className="flex items-center mb-4 gap-4 flex-wrap">
          <SearchInput
            value={searchInput}
            onChange={handleSearchInputChange}
            placeholder="Search by description"
          />
          <div className="w-48 shrink-0">
            <CustomSelect
              id="api-keys-status-filter"
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value as 'all' | 'active' | 'inactive');
                setCurrentPage(1);
              }}
              options={[
                { value: 'all', label: 'All Statuses' },
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
          </div>
          <div className="w-48 shrink-0">
            <DatePicker
              id="api-keys-last-used-filter"
              value={lastUsedAfter}
              onChange={(date) => {
                setLastUsedAfter(date);
                setCurrentPage(1);
              }}
              clearable
              placeholder="Last used after"
            />
          </div>
          <div className="w-48 shrink-0">
            <DatePicker
              id="api-keys-expires-before-filter"
              value={expiresBeforeDate}
              onChange={(date) => {
                setExpiresBeforeDate(date);
                setCurrentPage(1);
              }}
              clearable
              placeholder="Expires before"
            />
          </div>
          <Button
            id="reset-api-keys-filters"
            variant="ghost"
            size="sm"
            className={`shrink-0 flex items-center gap-1 ${isFiltered ? 'text-gray-500 hover:text-gray-700' : 'invisible'}`}
            onClick={handleResetFilters}
            disabled={!isFiltered}
          >
            <RotateCcw size={14} />
            Reset
          </Button>
        </div>
        <DataTable
          id="api-keys-table"
          data={filteredKeys}
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
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                id="copy-api-key-button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(newKeyValue);
                    toast.success('API key copied to clipboard!');
                  } catch (error) {
                    handleError(error, 'Failed to copy API key to clipboard');
                  }
                }}
                className="w-full"
              >
                Copy to Clipboard
              </Button>
              <Button
                id="download-api-key-button"
                onClick={handleDownloadKey}
                variant="outline"
                className="w-full"
              >
                Download as .txt
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
