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

// Map URL slugs to tab labels
const sectionToLabelMap: Record<string, string> = {
  'asset-import': 'Asset Import',
  'asset-export': 'Asset Export',
  'templates-automation': 'Templates & Automation',
};

// Map tab labels back to URL slugs
const labelToSlugMap: Record<string, string> = {
  'Asset Import': 'asset-import',
  'Asset Export': 'asset-export',
  'Templates & Automation': 'templates-automation',
};

const ImportExportSettings = (): React.JSX.Element => {
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
    const initialLabel = sectionParam ? sectionToLabelMap[sectionParam.toLowerCase()] : undefined;
    return initialLabel || 'Asset Import'; // Default to 'Asset Import'
  });

  // Update active tab when URL parameter changes
  useEffect(() => {
    const currentLabel = sectionParam ? sectionToLabelMap[sectionParam.toLowerCase()] : undefined;
    const targetTab = currentLabel || 'Asset Import';
    if (targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
  }, [sectionParam, activeTab]);

  const updateURL = useCallback((tabLabel: string) => {
    const urlSlug = labelToSlugMap[tabLabel];

    // Build new URL preserving existing parameters
    const currentSearchParams = new URLSearchParams(window.location.search);

    if (urlSlug && urlSlug !== 'asset-import') {
      currentSearchParams.set('section', urlSlug);
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

  const handleTabChange = useCallback((tab: string) => {
    setActiveTab(tab);
    updateURL(tab);
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
      alert('Select an import source to continue.');
      return;
    }

    if (!file) {
      alert('Choose a CSV or XLSX file to continue.');
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
      label: 'Asset Import',
      content: (
        <div className="space-y-6">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="import-source">Import source</Label>
              <CustomSelect
                id="import-source"
                options={sourceOptions}
                value={selectedSourceId ?? ''}
                onValueChange={(value) => setSelectedSourceId(value || null)}
                placeholder={sources.length === 0 ? 'No import sources available' : 'Select an import source'}
                disabled={isLoading || sourceOptions.length === 0}
                className="h-10 !border-border/60 text-sm"
                customStyles={{
                  trigger: '!border-border/60 hover:bg-primary-500/5',
                }}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="import-file">Upload file</Label>
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
              Remember this mapping for future imports
            </Label>
          </div>

          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-medium text-foreground">Field mapping</h3>
              <p className="text-sm text-muted-foreground">
                Enter the column names from your file that correspond to each required asset field. Leave optional fields blank to skip them.
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
                      <span className="text-xs text-muted-foreground">e.g. {definition.example}</span>
                    )}
                  </div>
                  <Input
                    id={`field-${definition.field}`}
                    placeholder="Source column name"
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
              {isLoading ? 'Preparing Preview…' : 'Generate Preview'}
            </Button>
          </div>

          {preview && (
            <Card className="border border-muted">
              <CardHeader>
                <CardTitle className="text-lg">Import Preview</CardTitle>
                <CardDescription>
                  Showing up to the first 10 rows from {preview.preview.summary.totalRows} total records.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <PreviewStat label="Total" value={preview.preview.summary.totalRows} />
                  <PreviewStat label="Valid" value={preview.preview.summary.validRows} />
                  <PreviewStat label="Duplicates" value={preview.preview.summary.duplicateRows} />
                  <PreviewStat label="Errors" value={preview.preview.summary.errorRows} variant="destructive" />
                </div>

                {preview.errorSummary && preview.errorSummary.topErrors?.length > 0 && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      <span className="font-medium text-foreground">Validation issues detected.</span>
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
                      <TableHead className="w-20">Row</TableHead>
                      <TableHead>Values</TableHead>
                      <TableHead>Issues</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.preview.rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-6">
                          No preview rows available.
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
                    {isApproving ? 'Starting Import…' : 'Proceed with Import'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      ),
    },
    {
      label: 'Asset Export',
      content: (
        <div className="space-y-4">
          <Alert>
            <AlertDescription>
              Asset export tooling is coming soon. Planned capabilities include exporting filtered asset lists, audit data, and mapping templates directly to CSV/XLSX.
            </AlertDescription>
          </Alert>
        </div>
      ),
    },
    {
      label: 'Templates & Automation',
      content: (
        <div className="space-y-4">
          <Alert>
            <AlertDescription>
              Mapping templates and scheduled imports will live here. Save column mappings, share them across the team, and configure recurring jobs.
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
          <CardTitle>Import &amp; Export Workspace</CardTitle>
          <CardDescription>
            Configure imports, exports, and automated data flows from a single control centre.
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
            <CardTitle>Import &amp; Export History</CardTitle>
            <CardDescription>Review every import or export job in one place.</CardDescription>
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
                Refreshing…
              </span>
            ) : (
              'Refresh'
            )}
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Created</TableHead>
                <TableHead className="text-right">Duplicates</TableHead>
                <TableHead className="text-right">Errors</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                    No import or export jobs found. Generate a preview to create the first job.
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
                    <TableCell className="text-right text-amber-700">{job.duplicate_rows}</TableCell>
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
        label: 'Summary',
        content: (
          <div className="space-y-4">
            <InfoSection
              title="Source"
              rows={[
                { label: 'Original file name', value: details.file_name ?? '—' },
                { label: 'Stored file ID', value: details.source_file_id ?? '—' },
                { label: 'Document ID', value: details.source_document_id ?? '—' },
                { label: 'Document association', value: details.source_document_association_id ?? '—' }
              ]}
            />
            <InfoSection
              title="Client Association"
              rows={[
                { label: 'Associated client', value: associatedClientId ?? tenantClientId ?? '—' },
                { label: 'Default client context', value: defaultClientId ?? '—' },
                { label: 'Tenant client fallback', value: tenantClientId ?? '—' }
              ]}
            />
          </div>
        )
      },
      {
        label: `Records (${allItems.length})`,
        content: (
          <JobRecordsTable items={records} hasMore={hasMoreRecords} />
        )
      },
      {
        label: `Errors (${errorItems.length})`,
        content: <JobErrorsTable items={errorItems} />
      },
      {
        label: `Duplicates (${duplicateItems.length})`,
        content: <JobDuplicatesTable items={duplicateItems} />
      }
    ],
    [allItems.length, associatedClientId, details.file_name, details.source_document_association_id, details.source_document_id, details.source_file_id, duplicateItems, errorItems, hasMoreRecords, defaultClientId, tenantClientId]
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Import Job Details</h2>
        <p className="text-sm text-muted-foreground">
          Created {new Date(details.created_at).toLocaleString()} &middot; Status{' '}
          <span className="capitalize">{details.status}</span>
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <PreviewStat label="Total Rows" value={metrics.totalRows ?? details.total_rows} />
        <PreviewStat label="Processed" value={metrics.processedRows ?? details.processed_rows} />
        <PreviewStat label="Created" value={metrics.created ?? details.created_rows} />
        <PreviewStat label="Updated" value={metrics.updated ?? details.updated_rows} />
        <PreviewStat label="Duplicates" value={metrics.duplicates ?? details.duplicate_rows} />
        <PreviewStat label="Errors" value={metrics.errors ?? details.error_rows} variant="destructive" />
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
  if (!items.length) {
    return <p className="text-sm text-muted-foreground">No processed records yet.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>External ID</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sample Values</TableHead>
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
          Showing the first {items.length} records. Download the job results for full history.
        </p>
      )}
    </div>
  );
};

const JobErrorsTable = ({ items }: { items: ImportJobItemRecord[] }) => {
  if (!items.length) {
    return <p className="text-sm text-muted-foreground">No validation errors were recorded.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>External ID</TableHead>
            <TableHead>Error</TableHead>
            <TableHead>Sample Values</TableHead>
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
  if (!items.length) {
    return <p className="text-sm text-muted-foreground">No duplicates were detected for this job.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>External ID</TableHead>
            <TableHead>Duplicate Match</TableHead>
            <TableHead>Sample Values</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item, index) => (
            <TableRow key={item.import_job_item_id}>
              <TableCell className="font-medium text-foreground">
                {item.external_id ?? `Row ${index + 1}`}
              </TableCell>
              <TableCell className="text-amber-700">{renderDuplicateSummary(item)}</TableCell>
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
  const entries = Object.entries(data ?? {}).slice(0, maxEntries);

  if (!entries.length) {
    return <span className="text-sm text-muted-foreground">No values</span>;
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
