'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import type { ColumnDefinition } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getClientChecklistTemplates,
  type ClientChecklistTemplateSummary,
} from '../../actions/clientChecklistTemplateActions';
import { SectionLoadError } from './SectionLoadError';

interface ClientChecklistsTabProps {
  clientId: string;
}

const settingsHref = (templateId: string): string =>
  `/msp/settings?tab=ticketing&section=checklist-templates&template=${encodeURIComponent(templateId)}`;

/** Read-only list of the checklist templates scoped to this client. */
export default function ClientChecklistsTab({ clientId }: ClientChecklistsTabProps) {
  const { t } = useTranslation('msp/clients');
  const [templates, setTemplates] = useState<ClientChecklistTemplateSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setTemplates(await getClientChecklistTemplates(clientId));
    } catch (error) {
      console.error('Error loading client checklist templates:', error);
      setFailed(true);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) {
    return (
      <SectionLoadError
        id="client-checklists-retry"
        message={t('clientDetails.checklists.loadFailed', { defaultValue: 'Failed to load checklist templates' })}
        retryLabel={t('clientDetails.checklists.retry', { defaultValue: 'Retry' })}
        onRetry={() => void load()}
      />
    );
  }
  if (!templates) return <Skeleton className="h-24 w-full" />;

  const columns: ColumnDefinition<ClientChecklistTemplateSummary>[] = [
    {
      title: t('clientDetails.checklists.name', { defaultValue: 'Name' }),
      dataIndex: 'name',
      render: (value: string, record) => (
        <Link className="text-primary-600 hover:underline" href={settingsHref(record.template_id)}>
          {value}
        </Link>
      ),
    },
    {
      title: t('clientDetails.checklists.items', { defaultValue: 'Items' }),
      dataIndex: 'item_count',
    },
    {
      title: t('clientDetails.checklists.status', { defaultValue: 'Status' }),
      dataIndex: 'is_active',
      render: (value: boolean) => value
        ? t('clientDetails.checklists.active', { defaultValue: 'Active' })
        : t('clientDetails.checklists.inactive', { defaultValue: 'Inactive' }),
    },
  ];

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm space-y-3">
      <p className="text-sm text-gray-600">
        {t('clientDetails.checklists.description', {
          defaultValue: 'Checklist templates that are only offered on this client\'s tickets. Edit them in Settings > Ticketing > Checklist Templates.',
        })}
      </p>
      {templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('clientDetails.checklists.empty', { defaultValue: 'No client-specific checklist templates.' })}
        </p>
      ) : (
        <DataTable id="client-checklists-table" data={templates} columns={columns} pagination={false} />
      )}
    </div>
  );
}
