'use client';

// Auth-owned admin API key management UI.

import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import type { ColumnDefinition } from '@alga-psa/types';
import {
  adminListApiKeys,
  adminDeactivateApiKey,
} from '@/lib/actions/apiKeyActions';
import {
  clearApiRateLimitForKey,
  getApiRateLimitForKey,
  setApiRateLimitForKey,
  type ApiRateLimitSettingsValue,
  type ApiRateLimitSettingsView,
} from '@/lib/actions/apiKeyRateLimitActions';
import { Search, RotateCcw } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export interface AdminApiKey {
  api_key_id: string;
  description: string | null;
  username: string;
  first_name: string | null;
  last_name: string | null;
  created_at: Date;
  last_used_at: Date | null;
  expires_at: Date | null;
  active: boolean;
}

const AdminSearchInput = memo(({
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
      id="search-admin-api-keys"
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
AdminSearchInput.displayName = 'AdminSearchInput';

export default function AdminApiKeysSetup() {
  const { t } = useTranslation('msp/profile');
  const [apiKeys, setApiKeys] = useState<AdminApiKey[]>([]);
  const [rateLimitsByKey, setRateLimitsByKey] = useState<Record<string, ApiRateLimitSettingsView>>({});
  const [rateLimitDrafts, setRateLimitDrafts] = useState<Record<string, ApiRateLimitSettingsValue>>({});
  const [editingRateLimitKeyId, setEditingRateLimitKeyId] = useState<string | null>(null);
  const [savingRateLimitKeyId, setSavingRateLimitKeyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        const matchesDescription = key.description?.toLowerCase().includes(term);
        const matchesUsername = key.username?.toLowerCase().includes(term);
        const matchesFirstName = key.first_name?.toLowerCase().includes(term);
        const matchesLastName = key.last_name?.toLowerCase().includes(term);
        const fullName = [key.first_name, key.last_name].filter(Boolean).join(' ').toLowerCase();
        const matchesFullName = fullName.includes(term);
        if (!matchesDescription && !matchesUsername && !matchesFirstName && !matchesLastName && !matchesFullName) return false;
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

  useEffect(() => {
    loadApiKeys();
  }, []);

  const seedRateLimitDraft = useCallback((view: ApiRateLimitSettingsView) => {
    setRateLimitDrafts((previous) => ({
      ...previous,
      [view.apiKeyId]: view.override ?? view.effective,
    }));
  }, []);

  const loadRateLimits = useCallback(async (keys: AdminApiKey[]) => {
    if (keys.length === 0) {
      setRateLimitsByKey({});
      setRateLimitDrafts({});
      return;
    }

    const views = await Promise.all(keys.map((key) => getApiRateLimitForKey(key.api_key_id)));
    const nextViews = Object.fromEntries(views.map((view) => [view.apiKeyId, view]));
    const nextDrafts = Object.fromEntries(
      views.map((view) => [view.apiKeyId, view.override ?? view.effective]),
    );

    setRateLimitsByKey(nextViews);
    setRateLimitDrafts(nextDrafts);
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
      await loadRateLimits(formattedKeys);
      setApiKeys(formattedKeys);
      setError(null);
    } catch (error) {
      console.error('Failed to load API keys:', error);
      setError('Failed to load API keys. Please ensure you have admin privileges.');
    }
  };

  const handleRateLimitDraftChange = useCallback((
    apiKeyId: string,
    field: keyof ApiRateLimitSettingsValue,
    value: string,
  ) => {
    const parsed = Number.parseInt(value, 10);
    setRateLimitDrafts((previous) => ({
      ...previous,
      [apiKeyId]: {
        ...(previous[apiKeyId] ?? { maxTokens: 120, refillPerMin: 60 }),
        [field]: Number.isFinite(parsed) ? parsed : 0,
      },
    }));
  }, []);

  const handleEditRateLimit = useCallback((view: ApiRateLimitSettingsView) => {
    seedRateLimitDraft(view);
    setEditingRateLimitKeyId(view.apiKeyId);
  }, [seedRateLimitDraft]);

  const handleCancelRateLimitEdit = useCallback((view: ApiRateLimitSettingsView) => {
    seedRateLimitDraft(view);
    setEditingRateLimitKeyId(null);
  }, [seedRateLimitDraft]);

  const handleSaveRateLimit = useCallback(async (apiKeyId: string) => {
    const draft = rateLimitDrafts[apiKeyId];
    if (!draft) {
      return;
    }

    try {
      setSavingRateLimitKeyId(apiKeyId);
      const updatedView = await setApiRateLimitForKey(apiKeyId, draft);
      setRateLimitsByKey((previous) => ({ ...previous, [apiKeyId]: updatedView }));
      seedRateLimitDraft(updatedView);
      setEditingRateLimitKeyId(null);
      setError(null);
    } catch (error) {
      console.error('Failed to save API rate limit override:', error);
      setError(t('security.apiKeys.rateLimit.errors.saveFailed'));
    } finally {
      setSavingRateLimitKeyId(null);
    }
  }, [rateLimitDrafts, seedRateLimitDraft, t]);

  const handleClearRateLimit = useCallback(async (apiKeyId: string) => {
    try {
      setSavingRateLimitKeyId(apiKeyId);
      const updatedView = await clearApiRateLimitForKey(apiKeyId);
      setRateLimitsByKey((previous) => ({ ...previous, [apiKeyId]: updatedView }));
      seedRateLimitDraft(updatedView);
      if (editingRateLimitKeyId === apiKeyId) {
        setEditingRateLimitKeyId(null);
      }
      setError(null);
    } catch (error) {
      console.error('Failed to clear API rate limit override:', error);
      setError(t('security.apiKeys.rateLimit.errors.clearFailed'));
    } finally {
      setSavingRateLimitKeyId(null);
    }
  }, [editingRateLimitKeyId, seedRateLimitDraft, t]);

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
      render: (_: string, record: AdminApiKey) => {
        const name = [record.first_name, record.last_name].filter(Boolean).join(' ');
        return name || record.username;
      },
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
      title: t('security.apiKeys.rateLimit.columnTitle'),
      dataIndex: 'api_key_id',
      width: '25%',
      render: (_: string, record: AdminApiKey) => {
        const view = rateLimitsByKey[record.api_key_id];
        if (!view) {
          return <span className="text-sm text-gray-500">{t('security.apiKeys.rateLimit.loading')}</span>;
        }

        const draft = rateLimitDrafts[record.api_key_id] ?? view.override ?? view.effective;
        const isEditing = editingRateLimitKeyId === record.api_key_id;
        const isSaving = savingRateLimitKeyId === record.api_key_id;
        const sourceLabel = t(`security.apiKeys.rateLimit.sourceLabels.${view.source}`);
        const remainingText = view.bucketState
          ? t('security.apiKeys.rateLimit.remaining', {
              remaining: view.bucketState.remaining,
              maxTokens: view.bucketState.maxTokens,
            })
          : t('security.apiKeys.rateLimit.remainingUnavailable');

        return (
          <div className="space-y-2 text-sm">
            <div>
              <div className="font-medium">
                {t('security.apiKeys.rateLimit.summary', {
                  maxTokens: view.effective.maxTokens,
                  refillPerMin: view.effective.refillPerMin,
                })}
              </div>
              <div className="text-gray-500">
                {t('security.apiKeys.rateLimit.source', { label: sourceLabel })}
                {remainingText}
              </div>
            </div>

            {isEditing ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    id={`api-rate-limit-max-tokens-${record.api_key_id}`}
                    type="number"
                    min={1}
                    value={String(draft.maxTokens)}
                    onChange={(event) =>
                      handleRateLimitDraftChange(record.api_key_id, 'maxTokens', event.target.value)
                    }
                  />
                  <Input
                    id={`api-rate-limit-refill-${record.api_key_id}`}
                    type="number"
                    min={1}
                    value={String(draft.refillPerMin)}
                    onChange={(event) =>
                      handleRateLimitDraftChange(record.api_key_id, 'refillPerMin', event.target.value)
                    }
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    id={`save-api-rate-limit-${record.api_key_id}`}
                    size="sm"
                    onClick={() => handleSaveRateLimit(record.api_key_id)}
                    disabled={isSaving}
                  >
                    {t('security.apiKeys.rateLimit.actions.save')}
                  </Button>
                  <Button
                    id={`cancel-api-rate-limit-${record.api_key_id}`}
                    size="sm"
                    variant="ghost"
                    onClick={() => handleCancelRateLimitEdit(view)}
                    disabled={isSaving}
                  >
                    {t('security.apiKeys.rateLimit.actions.cancel')}
                  </Button>
                  {view.override ? (
                    <Button
                      id={`reset-api-rate-limit-${record.api_key_id}`}
                      size="sm"
                      variant="ghost"
                      onClick={() => handleClearRateLimit(record.api_key_id)}
                      disabled={isSaving}
                    >
                      {t('security.apiKeys.rateLimit.actions.reset')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button
                  id={`edit-api-rate-limit-${record.api_key_id}`}
                  size="sm"
                  variant="ghost"
                  onClick={() => handleEditRateLimit(view)}
                >
                  {view.override
                    ? t('security.apiKeys.rateLimit.actions.edit')
                    : t('security.apiKeys.rateLimit.actions.override')}
                </Button>
                {view.override ? (
                  <Button
                    id={`clear-api-rate-limit-${record.api_key_id}`}
                    size="sm"
                    variant="ghost"
                    onClick={() => handleClearRateLimit(record.api_key_id)}
                    disabled={isSaving}
                  >
                    {t('security.apiKeys.rateLimit.actions.reset')}
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        );
      },
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
  ], [
    editingRateLimitKeyId,
    handleCancelRateLimitEdit,
    handleClearRateLimit,
    handleDeactivateKey,
    handleEditRateLimit,
    handleRateLimitDraftChange,
    handleSaveRateLimit,
    rateLimitDrafts,
    rateLimitsByKey,
    savingRateLimitKeyId,
    t,
  ]);

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="text-2xl font-semibold mb-4">API Keys Administration</h2>
        {error && (
          <div className="mb-4 p-4 bg-destructive/10 text-destructive rounded-md">
            {error}
          </div>
        )}
        <div className="flex items-center mb-4 gap-4 flex-wrap">
          <AdminSearchInput
            value={searchInput}
            onChange={handleSearchInputChange}
            placeholder="Search by user or description"
          />
          <div className="w-48 shrink-0">
            <CustomSelect
              id="admin-api-keys-status-filter"
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
              id="admin-api-keys-last-used-filter"
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
              id="admin-api-keys-expires-before-filter"
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
            id="reset-admin-api-keys-filters"
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
          id="admin-api-keys-table"
          data={filteredKeys}
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
