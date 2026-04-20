'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@alga-psa/ui/components/Button';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Switch } from '@alga-psa/ui/components/Switch';
import type { ColumnDefinition } from '@alga-psa/types';
import { Archive, Copy, MoreVertical, Plus, Sparkles, Undo2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  archiveServiceRequestDefinitionAction,
  createBlankServiceRequestDefinitionAction,
  createServiceRequestDefinitionFromTemplateAction,
  duplicateServiceRequestDefinitionAction,
  listServiceRequestDefinitionsAction,
  listServiceRequestTemplatesAction,
  unarchiveServiceRequestDefinitionAction,
} from './actions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';

interface ServiceRequestDefinitionRow {
  definition_id: string;
  name: string;
  description: string | null;
  lifecycle_state: 'draft' | 'published' | 'archived';
  published_at: string | Date | null;
  updated_at: string | Date;
}

interface ServiceRequestTemplateRow {
  providerKey: string;
  templateId: string;
  templateName: string;
  providerDisplayName: string;
}

function lifecycleLabel(
  row: ServiceRequestDefinitionRow,
  t: (key: string) => string
): string {
  if (row.lifecycle_state === 'published') {
    return t('management.lifecycleLabels.published');
  }
  if (row.lifecycle_state === 'archived') {
    return t('management.lifecycleLabels.archived');
  }
  if (row.published_at) {
    return t('management.lifecycleLabels.draftChanges');
  }
  return t('management.lifecycleLabels.draft');
}

export default function ServiceRequestsManagementPage() {
  const router = useRouter();
  const { t } = useTranslation('msp/service-requests');
  const [definitions, setDefinitions] = useState<ServiceRequestDefinitionRow[]>([]);
  const [templates, setTemplates] = useState<ServiceRequestTemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [isPending, startTransition] = useTransition();

  const hasTemplates = templates.length > 0;
  const archivedCount = useMemo(
    () => definitions.filter((definition) => definition.lifecycle_state === 'archived').length,
    [definitions]
  );
  const visibleDefinitions = useMemo(
    () =>
      showArchived
        ? definitions
        : definitions.filter((definition) => definition.lifecycle_state !== 'archived'),
    [definitions, showArchived]
  );

  const reload = async () => {
    const [definitionsResult, templatesResult] = await Promise.all([
      listServiceRequestDefinitionsAction(),
      listServiceRequestTemplatesAction(),
    ]);
    setDefinitions(definitionsResult as ServiceRequestDefinitionRow[]);
    setTemplates(
      (templatesResult as ServiceRequestTemplateRow[]).sort((a, b) =>
        a.templateName.localeCompare(b.templateName)
      )
    );
  };

  useEffect(() => {
    const load = async () => {
      try {
        await reload();
      } catch (error) {
        console.error('Failed to load service request definitions', error);
        toast.error(t('messages.error.loadFailed'));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const columns = useMemo<ColumnDefinition<ServiceRequestDefinitionRow>[]>(
    () => [
      {
        title: t('management.columns.name'),
        dataIndex: 'name',
        render: (value, row) => (
          <Link
            href={`/msp/service-requests/${row.definition_id}`}
            className="text-blue-600 hover:underline"
          >
            {value as string}
          </Link>
        ),
      },
      {
        title: t('management.columns.description'),
        dataIndex: 'description',
        render: (value) => (value as string | null) ?? '-',
      },
      {
        title: t('management.columns.state'),
        dataIndex: 'lifecycle_state',
        render: (_value, row) => lifecycleLabel(row, t),
      },
      {
        title: t('management.columns.updated'),
        dataIndex: 'updated_at',
        render: (value) => new Date(value as string).toLocaleString(),
      },
      {
        title: t('management.columns.actions'),
        dataIndex: 'definition_id',
        render: (_value, row) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                id={`service-request-actions-${row.definition_id}`}
                variant="ghost"
                size="sm"
                aria-label={t('management.actionsFor', { name: row.name })}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() =>
                  startTransition(async () => {
                    try {
                      await duplicateServiceRequestDefinitionAction(row.definition_id);
                      await reload();
                      toast.success(t('messages.success.definitionDuplicated'));
                    } catch (error) {
                      console.error('Failed to duplicate definition', error);
                      toast.error(t('messages.error.duplicateFailed'));
                    }
                  })
                }
              >
                <Copy className="mr-2 h-4 w-4" />
                {t('management.actions.duplicate')}
              </DropdownMenuItem>
              {row.lifecycle_state === 'archived' ? (
                <DropdownMenuItem
                  onClick={() =>
                    startTransition(async () => {
                      try {
                        await unarchiveServiceRequestDefinitionAction(row.definition_id);
                        await reload();
                        toast.success(t('messages.success.definitionUnarchived'));
                      } catch (error) {
                        console.error('Failed to unarchive definition', error);
                        toast.error(t('messages.error.unarchiveFailed'));
                      }
                    })
                  }
                >
                  <Undo2 className="mr-2 h-4 w-4" />
                  {t('management.actions.unarchive')}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={() =>
                    startTransition(async () => {
                      try {
                        await archiveServiceRequestDefinitionAction(row.definition_id);
                        await reload();
                        toast.success(t('messages.success.definitionArchived'));
                      } catch (error) {
                        console.error('Failed to archive definition', error);
                        toast.error(t('messages.error.archiveFailed'));
                      }
                    })
                  }
                >
                  <Archive className="mr-2 h-4 w-4" />
                  {t('management.actions.archive')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [startTransition, t]
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('management.title')}</h1>
          <p className="text-sm text-[rgb(var(--color-text-600))]">
            {t('management.description')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="service-request-show-archived-toggle"
            checked={showArchived}
            onCheckedChange={(checked) => setShowArchived(checked === true)}
            disabled={loading || archivedCount === 0}
            label={
              archivedCount > 0
                ? t('management.showArchivedWithCount', { count: archivedCount })
                : t('management.showArchived')
            }
          />
          <Button
            id="service-request-create-blank"
            onClick={() =>
              startTransition(async () => {
                try {
                  await createBlankServiceRequestDefinitionAction();
                  await reload();
                  toast.success(t('messages.success.draftCreated'));
                } catch (error) {
                  console.error('Failed to create draft definition', error);
                  toast.error(t('messages.error.createDraftFailed'));
                }
              })
            }
            disabled={isPending}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t('management.createBlank')}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                id="service-request-create-from-template"
                variant="outline"
                disabled={!hasTemplates || isPending}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                {t('management.startFromExample')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {templates.map((template) => (
                <DropdownMenuItem
                  key={`${template.providerKey}:${template.templateId}`}
                  onClick={() =>
                    startTransition(async () => {
                      try {
                        const created = await createServiceRequestDefinitionFromTemplateAction(
                          template.providerKey,
                          template.templateId
                        );
                        toast.success(
                          t('messages.success.draftCreatedFromExample', {
                            name: template.templateName,
                          })
                        );
                        router.push(`/msp/service-requests/${created.definition_id}`);
                      } catch (error) {
                        console.error('Failed to create draft from template', error);
                        toast.error(t('messages.error.createFromExampleFailed'));
                      }
                    })
                  }
                >
                  {template.templateName} <span className="ml-2 text-xs opacity-70">({template.providerDisplayName})</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <DataTable
        id="service-requests-management-table"
        data={visibleDefinitions}
        columns={columns}
        pagination={true}
        currentPage={1}
        pageSize={25}
        onPageChange={() => {}}
      />
      {loading && <div className="text-sm text-[rgb(var(--color-text-600))]">{t('management.loading')}</div>}
    </div>
  );
}
