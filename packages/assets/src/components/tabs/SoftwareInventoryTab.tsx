'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTileData } from '@alga-psa/ui/components/bento';
import { Search } from 'lucide-react';
import type {
  Asset,
  AssetSoftwareDisplayItem,
  AssetSoftwareListResponse,
  ColumnDefinition,
  SoftwareCategory,
} from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getAssetSoftware } from '../../actions/softwareActions';

interface SoftwareInventoryTabProps {
  asset: Asset;
}

export const SOFTWARE_TAB_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;
const ALL_CATEGORIES = 'All';

type Row = AssetSoftwareDisplayItem & { id: string };

/**
 * Software installed on one asset, read from the normalized asset_software
 * table — the same source as the client-level Software view, so a drill from
 * there (?software=<title>) lands on the rows it listed, whichever RMM wrote them.
 */
export const SoftwareInventoryTab: React.FC<SoftwareInventoryTabProps> = ({ asset }) => {
  const { t } = useTranslation('msp/assets');
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState(() => searchParams?.get('software') ?? '');
  const [search, setSearch] = useState(() => (searchParams?.get('software') ?? '').trim());
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const { data, error, loading } = useTileData<AssetSoftwareListResponse>(
    () => getAssetSoftware({
      asset_id: asset.asset_id,
      search: search || undefined,
      category: category === ALL_CATEGORIES ? undefined : (category as SoftwareCategory),
      page,
      limit: SOFTWARE_TAB_PAGE_SIZE,
    }),
    [asset.asset_id, search, category, page],
    () => t('softwareInventoryTab.loadError', { defaultValue: 'Could not load software inventory.' }),
  );

  const unknownValue = t('softwareInventoryTab.values.unknown', { defaultValue: 'Unknown' });
  const rows = useMemo<Row[]>(
    () => (data?.software ?? []).map((item) => ({ ...item, id: item.software_id })),
    [data],
  );
  const columns = useMemo<ColumnDefinition<Row>[]>(() => [
    {
      title: t('softwareInventoryTab.table.name', { defaultValue: 'Name' }),
      dataIndex: 'name',
      sortable: false,
      render: (value: string) => <span className="font-medium text-gray-900">{value}</span>,
    },
    {
      title: t('softwareInventoryTab.table.version', { defaultValue: 'Version' }),
      dataIndex: 'version',
      sortable: false,
      render: (value: string | null) => <span className="text-gray-500">{value || unknownValue}</span>,
    },
    {
      title: t('softwareInventoryTab.table.publisher', { defaultValue: 'Publisher' }),
      dataIndex: 'publisher',
      sortable: false,
      render: (value: string | null) => <span className="text-gray-500">{value || unknownValue}</span>,
    },
    {
      title: t('softwareInventoryTab.table.installDate', { defaultValue: 'Install Date' }),
      dataIndex: 'install_date',
      sortable: false,
      render: (value: string | null) => (
        <span className="text-gray-500">{value ? new Date(value).toLocaleDateString() : '-'}</span>
      ),
    },
  ], [t, unknownValue]);

  const total = data?.total ?? 0;
  const filtered = Boolean(search) || category !== ALL_CATEGORIES;
  const showEmpty = !loading && !error && data !== null && total === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('softwareInventoryTab.title', { defaultValue: 'Software Inventory' })}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" aria-hidden="true" />
            <Input
              id="asset-software-search"
              placeholder={t('softwareInventoryTab.searchPlaceholder', {
                defaultValue: 'Search software...'
              })}
              aria-label={t('softwareInventoryTab.searchPlaceholder', { defaultValue: 'Search software...' })}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
            />
          </div>
          <CustomSelect
            id="asset-software-category"
            placeholder={t('softwareInventoryTab.category.placeholder', {
              defaultValue: 'Category'
            })}
            options={[
              { value: ALL_CATEGORIES, label: t('softwareInventoryTab.category.options.all', { defaultValue: 'All' }) },
              { value: 'Browser', label: t('softwareInventoryTab.category.options.browser', { defaultValue: 'Browser' }) },
              { value: 'Security', label: t('softwareInventoryTab.category.options.security', { defaultValue: 'Security' }) },
              { value: 'Productivity', label: t('softwareInventoryTab.category.options.productivity', { defaultValue: 'Productivity' }) },
              { value: 'Development', label: t('softwareInventoryTab.category.options.development', { defaultValue: 'Development' }) }
            ]}
            value={category}
            onValueChange={(value) => { setCategory(value); setPage(1); }}
            className="w-48"
          />
        </div>

        {error && (
          <p id="asset-software-error" className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        {showEmpty ? (
          <div id="asset-software-empty" className="h-24 flex items-center justify-center text-center text-gray-400">
            {filtered
              ? t('softwareInventoryTab.empty', { defaultValue: 'No software found matching your search.' })
              : t('softwareInventoryTab.noInventory', { defaultValue: 'No software inventory has been collected for this device yet.' })}
          </div>
        ) : !error && (
          <DataTable
            id="asset-software-table"
            data={rows}
            columns={columns}
            pagination
            persistPageSize={false}
            pageSize={SOFTWARE_TAB_PAGE_SIZE}
            currentPage={page}
            onPageChange={setPage}
            totalItems={total}
          />
        )}

        <div className="mt-4 text-xs text-gray-400 text-right">
          {t('softwareInventoryTab.totalItems', {
            defaultValue: 'Total Items: {{count}}',
            count: total
          })}
        </div>
      </CardContent>
    </Card>
  );
};
