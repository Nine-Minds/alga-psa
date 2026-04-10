'use client';

import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomTabs, { type TabContent } from '@alga-psa/ui/components/CustomTabs';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import Drawer from '@alga-psa/ui/components/Drawer';
import Spinner from '@alga-psa/ui/components/Spinner';
import type { ImportJobDetails, ImportJobItemRecord, ImportJobRecord } from '@/types/imports.types';
import { useImportActions } from './hooks/useImportActions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const SECTION_SLUGS = ['asset-import', 'asset-export', 'templates-automation'] as const;

const ImportExportSettings = (): React.JSX.Element => {
  const { t } = useTranslation('msp/settings');
  const searchParams = useSearchParams();

  const sectionParam = searchParams?.get('section');

  const {
    isLoading,
    isApproving,
    error,
    detailsError,
    isLoadingDetails,
    isRefreshingHistory,
    sources,
    history,
    preview,
    selectedJobDetails,
    fieldDefinitions,
    selectedSourceId,
    setSelectedSourceId,
    fieldMapping,
    setFieldMapping,
    createPreview,
    approveImport,
    loadJobDetails,
    clearSelectedJobDetails,
    refreshHistory,
  } = useImportActions();

  // Determine initial active tab based on URL parameter
  const [activeTab, setActiveTab] = useState<string>(() => {
    const requestedTab = sectionParam?.toLowerCase();
    return requestedTab && SECTION_SLUGS.includes(requestedTab as typeof SECTION_SLUGS[number])
      ? requestedTab
      : SECTION_SLUGS[0];
  });

  // Update active tab when URL parameter changes
  useEffect(() => {
    const requestedTab = sectionParam?.toLowerCase();
    const targetTab = requestedTab && SECTION_SLUGS.includes(requestedTab as typeof SECTION_SLUGS[number])
      ? requestedTab
      : SECTION_SLUGS[0];
    if (targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
  }, [sectionParam, activeTab]);

  const updateURL = useCallback((tabId: string) => {
    // Build new URL preserving existing parameters
    const currentSearchParams = new URLSearchParams(window.location.search);

    if (tabId !== SECTION_SLUGS[0]) {
      currentSearchParams.set('section', tabId);
    } else {
      currentSearchParams.delete('section');
    }

    // Preserve the tab parameter for import-export
    if (!currentSearchParams.has('tab')) {
      currentSearchParams.set('tab', 'import-export');
    }

    const newUrl = `/msp/settings?${currentSearchParams.toString()}`;
    window.history.pushState({}, '', newUrl);
  }, []);

  const handleTabChange = useCallback((tabId: string) => {
    setActiveTab(tabId);
    updateURL(tabId);
  }, [updateURL]);

  const [file, setFile] = useState<File | null>(null);
  const [persistTemplate, setPersistTemplate] = useState(true);
  const [isDetailsOpen, setDetailsOpen] = useState(false);

  const sourceOptions = useMemo(
    () =>
      sources.map((source) => ({
        value: source.import_source_id,
        label: source.name,
      })),
    [sources]
  );

  const sourceNameById = useMemo(() => {
    const map = new Map<string, string>();
    sources.forEach((source) => {
      map.set(source.import_source_id, source.name);
    });
    return map;
  }, [sources]);

  const previewHasWarnings = useMemo(() => {
    if (!preview) {
      return false;
    }

    const summary = preview.preview?.summary;
    const hasSummaryIssues =
      !!summary && ((summary.errorRows ?? 0) > 0 || (summary.duplicateRows ?? 0) > 0);

    const hasTopErrors = Boolean(preview.errorSummary && preview.errorSummary.topErrors?.length);

    const hasRowIssues =
      Array.isArray(preview.preview?.rows) &&
      preview.preview.rows.some(
        (row: any) =>
          (row.validationErrors?.length ?? 0) > 0 ||
          Boolean(row.duplicate?.isDuplicate)
      );

    return hasSummaryIssues || hasTopErrors || hasRowIssues;
  }, [preview]);

  const handleMappingChange = (field: string, value: string) => {
    setFieldMapping((prev) => {
      const next = { ...prev };

      // Remove existing mapping referencing this target
      Object.entries(next).forEach(([sourceField, definition]) => {
        if (definition.target === field) {
          delete next[sourceField];
        }
      });

      if (value.trim().length > 0) {
        next[value.trim()] = { target: field };
      }

      return next;
    });
  };

  const getSourceValueForField = (field: string) => {
    const entry = Object.entries(fieldMapping).find(([, definition]) => definition.target === field);
    return entry ? entry[0] : '';
  };

  const handleSubmit = async () => {
    if (!selectedSourceId) {
      alert(t('importExport.import.alerts.selectSource'));
      return;
    }

    if (!file) {
      alert(t('importExport.import.alerts.chooseFile'));
      return;
    }

    await createPreview({
      importSourceId: selectedSourceId,
      mapping: fieldMapping,
      file,
      persistTemplate,
    });
  };

  const handleHistoryRowClick = useCallback(
    (job: ImportJobRecord) => {
      clearSelectedJobDetails();
      setDetailsOpen(true);
      loadJobDetails(job.import_job_id);
    },
    [clearSelectedJobDetails, loadJobDetails]
  );

  const handleCloseDetails = useCallback(() => {
    setDetailsOpen(false);
    clearSelectedJobDetails();
  }, [clearSelectedJobDetails]);

  const tabs: TabContent[] = useMemo(() => [
    {
      id: 'asset-import',
      label: t('importExport.tabs.assetImport'),
      content: (
        <div className="space-y-6">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="import-source">{t('importExport.import.fields.importSource')}</Label>
              <CustomSelect
                id="import-source"
                options={sourceOptions}
                value={selectedSourceId ?? ''}
                onValueChange={(value) => setSelectedSourceId(value || null)}
                placeholder={sources.length === 0 ? t('importExport.import.placeholders.noSources') : t('importExport.import.placeholders.selectSource')}
                disabled={isLoading || sourceOptions.length === 0}
                className="h-10 !border-border/60 text-sm"
                customStyles={{
                  trigger: '!border-border/60 hover:bg-primary-500/5',
                }}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="import-file">{t('importExport.import.fields.uploadFile')}</Label>
              <Input
                id="import-file"
                type="file"
                className="h-13 !border-border/60 !focus:ring-primary-400 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary-500/10 file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-700"
                accept=".csv,.xlsx"
                onChange={(event) => {
                  const nextFile = event.target.files?.[0] ?? null;
                  setFile(nextFile);
                }}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="persist-template"
              checked={persistTemplate}
              onChange={(event) => setPersistTemplate(event.currentTarget.checked)}
            />
            <Label htmlFor="persist-template" className="text-sm font-normal">
              {t('importExport.import.fields.rememberMapping')}
            </Label>
          </div>

          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-medium text-foreground">{t('importExport.import.fields.fieldMapping')}</h3>
              <p className="text-sm text-muted-foreground">
                {t('importExport.import.help.fieldMapping')}
              </p>
            </div>

            <div className="grid gap-3">
              {fieldDefinitions.map((definition) => (
                <div key={definition.field} className="grid gap-1">
                  <div className="flex items-center justify-between">
                    <Label htmlFor={`field-${definition.field}`}>
                      {definition.label}
                      {definition.required && <span className="text-destructive"> *</span>}
                    </Label>
                    {definition.example && (
                      <span className="text-xs text-muted-foreground">{t('importExport.import.placeholders.example', { example: definition.example })}</span>
                    )}
                  </div>
                  <Input
                    id={`field-${definition.field}`}
                    placeholder={t('importExport.import.placeholders.sourceColumn')}
                    value={getSourceValueForField(definition.field)}
                    onChange={(event) => handleMappingChange(definition.field, event.target.value)}
                    disabled={isLoading}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button id="start-import-button" onClick={handleSubmit} disabled={isLoading || !file || !selectedSourceId}>
              {isLoading ? t('importExport.import.actions.preparingPreview') : t('importExport.import.actions.generatePreview')}
            </Button>
          </div>

          {preview && (
            <Card className="border border-muted">
              <CardHeader>
                <CardTitle className="text-lg">{t('importExport.import.preview.title')}</CardTitle>
                <CardDescription>
                  {t('importExport.import.preview.description', { totalRows: preview.preview.summary.totalRows })}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <PreviewStat label={t('importExport.import.preview.stats.total')} value={preview.preview.summary.totalRows} />
                  <PreviewStat label={t('importExport.import.preview.stats.valid')} value={preview.preview.summary.validRows} />
                  <PreviewStat label={t('importExport.import.preview.stats.duplicates')} value={preview.preview.summary.duplicateRows} />
                  <PreviewStat label={t('importExport.import.preview.stats.errors')} value={preview.preview.summary.errorRows} variant="destructive" />
                </div>

                {preview.errorSummary && preview.errorSummary.topErrors?.length > 0 && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      <span className="font-medium text-foreground">{t('importExport.import.alerts.validationIssues')}</span>
                      <ul className="list-disc pl-5 mt-2 space-y-1 text-sm">
                        {preview.errorSummary.topErrors.map((issue: any) => (
                          <li key={issue.field}>
                            <span className="font-medium">{issue.field}</span>: {issue.sampleMessage} ({issue.count} occurrences)
                          </li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">{t('importExport.import.preview.table.row')}</TableHead>
                      <TableHead>{t('importExport.import.preview.table.values')}</TableHead>
                      <TableHead>{t('importExport.import.preview.table.issues')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.preview.rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-6">
                          {t('importExport.import.preview.empty')}
                        </TableCell>
                      </TableRow>
                    ) : (
                      preview.preview.rows.map((row: any) => (
                        <TableRow key={row.rowNumber}>
                          <TableCell>{row.rowNumber}</TableCell>
                          <TableCell>
                            <div className="grid gap-1 text-sm">
                              {Object.entries(row.values ?? {}).map(([key, value]) => (
                                <div key={key} className="flex gap-2">
                                  <span className="font-medium text-foreground w-32 truncate">{key}</span>
                                  <span className="text-muted-foreground flex-1 truncate">{String(value ?? '')}</span>
                                </div>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1 text-sm text-muted-foreground">
                              {(row.validationErrors ?? []).map((issue: any, index: number) => (
                                <div key={`${row.rowNumber}-error-${index}`} className="text-destructive">
                                  {issue.field}: {issue.message}
                                </div>
                              ))}
                              {row.duplicate?.isDuplicate && (
                                <div className="text-amber-600">
                                  Potential duplicate ({row.duplicate.matchType})
                                </div>
                              )}
                              {!row.validationErrors?.length && !row.duplicate?.isDuplicate && '—'}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>

                <div className="flex gap-3 justify-end">
                  <Button
                    id="approve-import-button"
                    variant={previewHasWarnings ? 'accent' : 'default'}
                    onClick={() => approveImport(preview.importJobId)}
                    disabled={isApproving || isLoading}
                  >
                    {isApproving ? t('importExport.import.actions.startingImport') : t('importExport.import.actions.proceedWithImport')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      ),
    },
    {
      id: 'asset-export',
      label: t('importExport.tabs.assetExport'),
      content: (
        <div className="space-y-4">
          <Alert>
            <AlertDescription>
              {t('importExport.export.comingSoon')}
            </AlertDescription>
          </Alert>
        </div>
      ),
    },
    {
      id: 'templates-automation',
      label: t('importExport.tabs.templatesAutomation'),
      content: (
        <div className="space-y-4">
          <Alert>
            <AlertDescription>
              {t('importExport.templates.comingSoon')}
            </AlertDescription>
          </Alert>
        </div>
      ),
    },
  ], [createPreview, error, fieldDefinitions, fieldMapping, handleMappingChange, handleSubmit, isApproving, isLoading, persistTemplate, preview, previewHasWarnings, selectedSourceId, setPersistTemplate, setSelectedSourceId, setFile, sources, getSourceValueForField]);

  return (
    <div className="space-y-6" data-testid="import-export-settings">
      <Card>
        <CardHeader>
          <CardTitle>{t('importExport.title')}</CardTitle>
          <CardDescription>
            {t('importExport.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CustomTabs
            tabs={tabs}
            defaultTab={activeTab}
            onTabChange={handleTabChange}
            orientation="vertical"
            tabStyles={{
              list: 'border-border/40',
              trigger: 'text-sm font-medium data-[state=active]:bg-primary-500/10 rounded-md transition-colors',
              content: 'min-h-[260px]'
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>{t('importExport.history.title')}</CardTitle>
            <CardDescription>{t('importExport.history.description')}</CardDescription>
          </div>
          <Button
            id="refresh-import-export-history-button"
            variant="outline"
            onClick={refreshHistory}
            disabled={isLoading || isRefreshingHistory}
            className="w-full md:w-auto"
          >
            {isRefreshingHistory ? (
              <span className="flex items-center gap-2">
                <Spinner size="sm" />
                {t('importExport.import.actions.refreshing')}
              </span>
            ) : (
              t('importExport.import.actions.refresh')
            )}
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('importExport.history.table.date')}</TableHead>
                <TableHead>{t('importExport.history.table.source')}</TableHead>
                <TableHead>{t('importExport.history.table.file')}</TableHead>
                <TableHead>{t('importExport.history.table.status')}</TableHead>
                <TableHead className="text-right">{t('importExport.history.table.created')}</TableHead>
                <TableHead className="text-right">{t('importExport.history.table.duplicates')}</TableHead>
                <TableHead className="text-right">{t('importExport.history.table.errors')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                    {t('importExport.history.empty')}
                  </TableCell>
                </TableRow>
              ) : (
                history.map((job) => (
                  <TableRow
                    key={job.import_job_id}
                    onClick={() => handleHistoryRowClick(job)}
                    className="cursor-pointer transition-colors hover:bg-muted/60"
                  >
                    <TableCell>{new Date(job.created_at).toLocaleString()}</TableCell>
                    <TableCell>{sourceNameById.get(job.import_source_id) ?? job.import_source_id}</TableCell>
                    <TableCell>{job.file_name ?? '—'}</TableCell>
                    <TableCell className="capitalize">{job.status}</TableCell>
                    <TableCell className="text-right">{job.created_rows}</TableCell>
                    <TableCell className="text-right text-warning">{job.duplicate_rows}</TableCell>
                    <TableCell className="text-right text-destructive">{job.error_rows}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
      </CardContent>
    </Card>

    <Drawer isOpen={isDetailsOpen} onClose={handleCloseDetails}>
      <JobDetailsDrawerContent
        details={selectedJobDetails}
        isLoading={isLoadingDetails}
        error={detailsError}
      />
    </Drawer>
  </div>
);
};

const JobDetailsDrawerContent = ({
  details,
  isLoading,
  error,
}: {
  details: ImportJobDetails | null;
  isLoading: boolean;
  error: string | null;
}) => {
  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Spinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!details) {
    return <p className="text-sm text-muted-foreground">Select an import job to inspect its results.</p>;
  }

  return <ImportJobDetailsView details={details} />;
};

const ImportJobDetailsView = ({ details }: { details: ImportJobDetails }) => {
  const { t } = useTranslation('msp/settings');
  const allItems = details.items ?? [];
  const records = useMemo(() => allItems.slice(0, 50), [allItems]);
  const errorItems = useMemo(
    () => allItems.filter((item) => item.status === 'error'),
    [allItems]
  );
  const duplicateItems = useMemo(
    () => allItems.filter((item) => item.status === 'duplicate'),
    [allItems]
  );

  const context = (details.context ?? {}) as Record<string, unknown>;
  const associatedClientId =
    typeof context.associatedClientId === 'string'
      ? context.associatedClientId
      : typeof context.associated_client_id === 'string'
        ? context.associated_client_id
        : null;
  const defaultClientId =
    typeof context.defaultClientId === 'string'
      ? context.defaultClientId
      : typeof context.default_client_id === 'string'
        ? context.default_client_id
        : null;
  const tenantClientId =
    typeof context.tenantClientId === 'string'
      ? context.tenantClientId
      : typeof context.tenant_client_id === 'string'
        ? context.tenant_client_id
        : null;

  const metrics = details.metrics ?? {
    totalRows: details.total_rows,
    processedRows: details.processed_rows,
    created: details.created_rows,
    updated: details.updated_rows,
    duplicates: details.duplicate_rows,
    errors: details.error_rows
  };

  const hasMoreRecords = allItems.length > records.length;

  const detailTabs: TabContent[] = useMemo(
    () => [
      {
        id: 'summary',
        label: t('importExport.jobDetails.sections.summary'),
        content: (
          <div className="space-y-4">
            <InfoSection
              title={t('importExport.jobDetails.fields.source')}
              rows={[
                { label: t('importExport.jobDetails.fields.originalFileName'), value: details.file_name ?? '—' },
                { label: t('importExport.jobDetails.fields.storedFileId'), value: details.source_file_id ?? '—' },
                { label: t('importExport.jobDetails.fields.documentId'), value: details.source_document_id ?? '—' },
                { label: t('importExport.jobDetails.fields.documentAssociation'), value: details.source_document_association_id ?? '—' }
              ]}
            />
            <InfoSection
              title={t('importExport.jobDetails.fields.clientAssociation')}
              rows={[
                { label: t('importExport.jobDetails.fields.associatedClient'), value: associatedClientId ?? tenantClientId ?? '—' },
                { label: t('importExport.jobDetails.fields.defaultClientContext'), value: defaultClientId ?? '—' },
                { label: t('importExport.jobDetails.fields.tenantClientFallback'), value: tenantClientId ?? '—' }
              ]}
            />
          </div>
        )
      },
      {
        id: 'records',
        label: t('importExport.jobDetails.sections.records', { count: allItems.length }),
        content: (
          <JobRecordsTable items={records} hasMore={hasMoreRecords} />
        )
      },
      {
        id: 'errors',
        label: t('importExport.jobDetails.sections.errors', { count: errorItems.length }),
        content: <JobErrorsTable items={errorItems} />
      },
      {
        id: 'duplicates',
        label: t('importExport.jobDetails.sections.duplicates', { count: duplicateItems.length }),
        content: <JobDuplicatesTable items={duplicateItems} />
      }
    ],
    [allItems.length, associatedClientId, details.file_name, details.source_document_association_id, details.source_document_id, details.source_file_id, duplicateItems, errorItems, hasMoreRecords, defaultClientId, tenantClientId, t]
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">{t('importExport.jobDetails.title')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('importExport.history.table.created')} {new Date(details.created_at).toLocaleString()} &middot; {t('importExport.jobDetails.fields.status')}{' '}
          <span className="capitalize">{details.status}</span>
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <PreviewStat label={t('importExport.jobDetails.stats.totalRows')} value={metrics.totalRows ?? details.total_rows} />
        <PreviewStat label={t('importExport.jobDetails.stats.processed')} value={metrics.processedRows ?? details.processed_rows} />
        <PreviewStat label={t('importExport.jobDetails.stats.created')} value={metrics.created ?? details.created_rows} />
        <PreviewStat label={t('importExport.jobDetails.stats.updated')} value={metrics.updated ?? details.updated_rows} />
        <PreviewStat label={t('importExport.jobDetails.stats.duplicates')} value={metrics.duplicates ?? details.duplicate_rows} />
        <PreviewStat label={t('importExport.jobDetails.stats.errors')} value={metrics.errors ?? details.error_rows} variant="destructive" />
      </div>

      <CustomTabs
        tabs={detailTabs}
        tabStyles={{
          list: 'border-border/40',
          trigger: 'text-sm font-medium data-[state=active]:bg-primary-500/10 rounded-md transition-colors',
          content: 'min-h-[220px]'
        }}
      />
    </div>
  );
};

const InfoSection = ({
  title,
  rows
}: {
  title: string;
  rows: { label: string; value: ReactNode }[];
}) => (
  <div className="space-y-2">
    <h4 className="text-sm font-semibold text-foreground">{title}</h4>
    <div className="grid gap-2 rounded-md border border-border/60 bg-muted/40 p-3">
      {rows.map(({ label, value }) => (
        <InfoRow key={label} label={label} value={value ?? '—'} />
      ))}
    </div>
  </div>
);

const JobRecordsTable = ({
  items,
  hasMore
}: {
  items: ImportJobItemRecord[];
  hasMore?: boolean;
}) => {
  const { t } = useTranslation('msp/settings');
  if (!items.length) {
    return <p className="text-sm text-muted-foreground">{t('importExport.jobDetails.empty.noRecords')}</p>;
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('importExport.jobDetails.fields.externalId')}</TableHead>
              <TableHead>{t('importExport.jobDetails.fields.status')}</TableHead>
              <TableHead>{t('importExport.jobDetails.fields.sampleValues')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, index) => (
              <TableRow key={item.import_job_item_id}>
                <TableCell className="font-medium text-foreground">
                  {item.external_id ?? `Row ${index + 1}`}
                </TableCell>
                <TableCell className={`capitalize ${statusColor(item.status)}`}>{item.status}</TableCell>
                <TableCell>
                  <KeyValuePreview data={item.source_data} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {hasMore && (
        <p className="text-xs text-muted-foreground">
          {t('importExport.jobDetails.truncated', { count: items.length })}
        </p>
      )}
    </div>
  );
};

const JobErrorsTable = ({ items }: { items: ImportJobItemRecord[] }) => {
  const { t } = useTranslation('msp/settings');
  if (!items.length) {
    return <p className="text-sm text-muted-foreground">{t('importExport.jobDetails.empty.noErrors')}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('importExport.jobDetails.fields.externalId')}</TableHead>
            <TableHead>{t('importExport.jobDetails.fields.error')}</TableHead>
            <TableHead>{t('importExport.jobDetails.fields.sampleValues')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item, index) => (
            <TableRow key={item.import_job_item_id}>
              <TableCell className="font-medium text-foreground">
                {item.external_id ?? `Row ${index + 1}`}
              </TableCell>
              <TableCell className="text-destructive">{item.error_message ?? 'Unknown error'}</TableCell>
              <TableCell>
                <KeyValuePreview data={item.source_data} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

const JobDuplicatesTable = ({ items }: { items: ImportJobItemRecord[] }) => {
  const { t } = useTranslation('msp/settings');
  if (!items.length) {
    return <p className="text-sm text-muted-foreground">{t('importExport.jobDetails.empty.noDuplicates')}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('importExport.jobDetails.fields.externalId')}</TableHead>
            <TableHead>{t('importExport.jobDetails.fields.duplicateMatch')}</TableHead>
            <TableHead>{t('importExport.jobDetails.fields.sampleValues')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item, index) => (
            <TableRow key={item.import_job_item_id}>
              <TableCell className="font-medium text-foreground">
                {item.external_id ?? `Row ${index + 1}`}
              </TableCell>
              <TableCell className="text-warning">{renderDuplicateSummary(item)}</TableCell>
              <TableCell>
                <KeyValuePreview data={item.source_data} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

const KeyValuePreview = ({
  data,
  maxEntries = 3
}: {
  data: Record<string, unknown>;
  maxEntries?: number;
}) => {
  const { t } = useTranslation('msp/settings');
  const entries = Object.entries(data ?? {}).slice(0, maxEntries);

  if (!entries.length) {
    return <span className="text-sm text-muted-foreground">{t('importExport.jobDetails.empty.noValues')}</span>;
  }

  return (
    <div className="space-y-1 text-sm">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-start gap-2">
          <span className="min-w-[90px] text-muted-foreground">{key}</span>
          <span className="flex-1 break-all text-foreground">{formatValue(value)}</span>
        </div>
      ))}
    </div>
  );
};

const InfoRow = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="flex items-start justify-between gap-3 text-sm text-foreground">
    <span className="text-muted-foreground">{label}</span>
    <span className="max-w-[65%] break-all text-right">{value ?? '—'}</span>
  </div>
);

const statusColor = (status: ImportJobItemRecord['status']) => {
  switch (status) {
    case 'error':
      return 'text-destructive';
    case 'duplicate':
      return 'text-amber-600';
    case 'created':
      return 'text-emerald-600';
    case 'updated':
      return 'text-blue-600';
    default:
      return 'text-foreground';
  }
};

const formatValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return '—';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const renderDuplicateSummary = (item: ImportJobItemRecord) => {
  const details = (item.duplicate_details ?? {}) as Record<string, unknown>;
  const matchType =
    typeof details.matchType === 'string'
      ? details.matchType
      : typeof details.match_type === 'string'
        ? details.match_type
        : null;
  const matchedAssetId =
    typeof details.matchedAssetId === 'string'
      ? details.matchedAssetId
      : typeof details.matched_asset_id === 'string'
        ? details.matched_asset_id
        : null;
  const confidence =
    typeof details.confidence === 'number'
      ? `${(details.confidence * 100).toFixed(1)}%`
      : null;

  const parts = [
    matchType ? `Match: ${matchType}` : null,
    matchedAssetId ? `Asset: ${matchedAssetId}` : null,
    confidence ? `Confidence: ${confidence}` : null
  ].filter(Boolean);

  return parts.length ? parts.join(' • ') : 'Duplicate flagged';
};

const PreviewStat = ({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant?: 'default' | 'destructive';
}) => {
  const color = variant === 'destructive' ? 'text-destructive' : 'text-foreground';
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold ${color}`}>{value}</p>
    </div>
  );
};

export default ImportExportSettings;
