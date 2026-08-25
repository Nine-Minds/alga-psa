'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Label } from '@alga-psa/ui/components/Label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import Spinner from '@alga-psa/ui/components/Spinner';
import type { AmpEntityType } from '@alga-psa/migration-spec';
import {
  getMigrationOutcomeRecords,
  getMigrationOutcomeSummary,
  getMigrationReportCsv,
} from '@/lib/migrations/migrationActions';
import type {
  MigrationJobDetails,
  MigrationOutcomeRecord,
  MigrationOutcomeSummary,
} from '@/lib/migrations/types';
import {
  downloadTextFile,
  formatMigrationTimestamp,
  migrationEntityLabel,
  migrationErrorMessage,
} from './migrationUi';

const RECORD_LIMIT = 200;

const ACTION_BADGES: Record<MigrationOutcomeRecord['action'], { label: string; variant: 'success' | 'default-muted' | 'error' }> = {
  created: { label: 'Created', variant: 'success' },
  skipped: { label: 'Skipped', variant: 'default-muted' },
  failed: { label: 'Failed', variant: 'error' },
};

interface MigrationResultsPanelProps {
  details: MigrationJobDetails;
}

/**
 * Final outcome of a finished (or cancelled/failed) job: per-entity counters
 * plus a filterable drill-down into individual outcome records.
 */
const MigrationResultsPanel = ({ details }: MigrationResultsPanelProps): React.JSX.Element => {
  const { t } = useTranslation('msp/settings');
  const [summary, setSummary] = useState<MigrationOutcomeSummary[]>([]);
  const [isLoadingSummary, setIsLoadingSummary] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [entityFilter, setEntityFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [records, setRecords] = useState<MigrationOutcomeRecord[]>([]);
  const [isLoadingRecords, setIsLoadingRecords] = useState(true);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingSummary(true);
    setSummaryError(null);

    getMigrationOutcomeSummary(details.migrationJobId)
      .then((loaded) => {
        if (!cancelled) {
          setSummary(loaded);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSummaryError(migrationErrorMessage(error, 'Failed to load the outcome summary.'));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingSummary(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [details.migrationJobId]);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingRecords(true);
    setRecordsError(null);

    getMigrationOutcomeRecords(details.migrationJobId, {
      entityType: (entityFilter || undefined) as AmpEntityType | undefined,
      action: (actionFilter || undefined) as MigrationOutcomeRecord['action'] | undefined,
      limit: RECORD_LIMIT,
    })
      .then((loaded) => {
        if (!cancelled) {
          setRecords(loaded);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setRecordsError(migrationErrorMessage(error, 'Failed to load outcome records.'));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingRecords(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [actionFilter, details.migrationJobId, entityFilter]);

  const handleDownloadCsv = useCallback(async () => {
    setIsDownloading(true);
    setDownloadError(null);
    try {
      const csv = await getMigrationReportCsv(details.migrationJobId, 'outcome');
      downloadTextFile(`migration-outcome-${details.migrationJobId}.csv`, csv, 'text/csv');
    } catch (error) {
      setDownloadError(migrationErrorMessage(error, 'Failed to download the outcome CSV.'));
    } finally {
      setIsDownloading(false);
    }
  }, [details.migrationJobId]);

  const entityFilterOptions = useMemo(
    () =>
      summary.map((row) => ({
        value: row.entityType,
        label: migrationEntityLabel(row.entityType),
      })),
    [summary]
  );

  const actionFilterOptions = useMemo(
    () => [
      { value: 'created', label: 'Created' },
      { value: 'skipped', label: 'Skipped' },
      { value: 'failed', label: 'Failed' },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Results</h3>
          <p className="text-sm text-muted-foreground">
            {details.completedAt
              ? `Finished ${formatMigrationTimestamp(details.completedAt)}.`
              : 'The job is no longer running.'}{' '}
            Skipped records were already migrated by an earlier run of the same package.
          </p>
        </div>
        <Button
          id="amp-download-outcome-csv-button"
          variant="outline"
          onClick={() => void handleDownloadCsv()}
          disabled={isDownloading}
          className="w-full md:w-auto"
        >
          {isDownloading ? (
            <span className="flex items-center gap-2">
              <Spinner size="sm" />
              Preparing…
            </span>
          ) : (
            'Download outcome CSV'
          )}
        </Button>
      </div>

      {details.state === 'failed' && details.error && (
        <Alert variant="destructive">
          <AlertDescription>
            <span className="font-medium">The migration failed:</span>{' '}
            <span className="break-words">{details.error}</span>
          </AlertDescription>
        </Alert>
      )}
      {details.state === 'cancelled' && (
        <Alert>
          <AlertDescription>
            The migration was cancelled at a checkpoint. Records applied before the cancellation
            remain and are listed below.
          </AlertDescription>
        </Alert>
      )}
      {downloadError && (
        <Alert variant="destructive">
          <AlertDescription>{downloadError}</AlertDescription>
        </Alert>
      )}

      {summaryError ? (
        <Alert variant="destructive">
          <AlertDescription>{summaryError}</AlertDescription>
        </Alert>
      ) : isLoadingSummary ? (
        <div className="flex h-24 items-center justify-center">
          <Spinner size="md" />
        </div>
      ) : summary.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          No outcome records were written for this job.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {summary.map((row) => (
            <div key={row.entityType} className="rounded-md border border-border bg-card p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {migrationEntityLabel(row.entityType)}
              </p>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <span className="text-foreground">
                  <span className="text-lg font-semibold tabular-nums">{row.created}</span> created
                </span>
                <span className="text-muted-foreground">
                  <span className="text-lg font-semibold tabular-nums">{row.skipped}</span> skipped
                </span>
                <span className={row.failed > 0 ? 'text-destructive' : 'text-muted-foreground'}>
                  <span className="text-lg font-semibold tabular-nums">{row.failed}</span> failed
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="w-full space-y-2 md:w-56">
            <Label htmlFor="amp-outcome-entity-filter">Entity</Label>
            <CustomSelect
              id="amp-outcome-entity-filter"
              options={entityFilterOptions}
              value={entityFilter}
              onValueChange={setEntityFilter}
              placeholder="All entities"
              allowClear
            />
          </div>
          <div className="w-full space-y-2 md:w-56">
            <Label htmlFor="amp-outcome-action-filter">Action</Label>
            <CustomSelect
              id="amp-outcome-action-filter"
              options={actionFilterOptions}
              value={actionFilter}
              onValueChange={setActionFilter}
              placeholder="All actions"
              allowClear
            />
          </div>
        </div>

        {recordsError ? (
          <Alert variant="destructive">
            <AlertDescription>{recordsError}</AlertDescription>
          </Alert>
        ) : isLoadingRecords ? (
          <div className="flex h-24 items-center justify-center">
            <Spinner size="md" />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Entity</TableHead>
                    <TableHead>Source record</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead className="text-right">At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                        No outcome records match these filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    records.map((record) => {
                      const actionBadge = ACTION_BADGES[record.action];
                      return (
                        <TableRow key={`${record.stagedRecordId}-${record.attempt}`}>
                          <TableCell>{migrationEntityLabel(record.entityType)}</TableCell>
                          <TableCell className="break-all font-mono text-xs">
                            {record.sourceRecordId}
                          </TableCell>
                          <TableCell>
                            <Badge variant={actionBadge.variant} size="sm">
                              {actionBadge.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {record.action === 'failed' ? (
                              <span className="break-words text-sm text-destructive">
                                {record.errors.length > 0 ? record.errors.join('; ') : 'Unknown error'}
                              </span>
                            ) : record.action === 'created' && record.targetEntityId ? (
                              <span className="break-all font-mono text-xs text-foreground">
                                {record.targetEntityType ? `${record.targetEntityType}: ` : ''}
                                {record.targetEntityId}
                              </span>
                            ) : (
                              <span className="text-sm text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {formatMigrationTimestamp(record.createdAt)}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
            {records.length >= RECORD_LIMIT && (
              <p className="text-xs text-muted-foreground">
                Showing the first {RECORD_LIMIT} matching records. Download the outcome CSV for the
                complete list.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default MigrationResultsPanel;
