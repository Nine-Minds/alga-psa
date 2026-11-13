'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import Spinner from '@alga-psa/ui/components/Spinner';
import {
  executeMigrationJob,
  getMigrationPreflightReport,
  getMigrationReportCsv,
  preflightMigrationJob,
} from '@/lib/migrations/migrationActions';
import type { MigrationJobDetails, PreflightIssue, PreflightResult } from '@/lib/migrations/types';
import {
  downloadTextFile,
  formatMigrationTimestamp,
  migrationEntityLabel,
  migrationErrorMessage,
} from './migrationUi';

interface MigrationPreflightPanelProps {
  details: MigrationJobDetails;
  /** Called after preflight or execute changes the job's state. */
  onStateChanged: () => Promise<void> | void;
}

/**
 * Dry-run validation of the staged package against the tenant and the saved
 * configuration. The migration can only run from a clean (`ready`) preflight —
 * blocking issues always disable the run button.
 */
const MigrationPreflightPanel = ({ details, onStateChanged }: MigrationPreflightPanelProps): React.JSX.Element => {
  const { t } = useTranslation('msp/settings');
  // Loaders read the latest translator through a ref so a new `t` (namespace load,
  // language switch) never re-triggers the fetch.
  const tRef = useRef(t);
  tRef.current = t;
  const [report, setReport] = useState<PreflightResult | null>(null);
  const [isLoadingReport, setIsLoadingReport] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPreflighting, setIsPreflighting] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingReport(true);
    setLoadError(null);

    getMigrationPreflightReport(details.migrationJobId)
      .then((loaded) => {
        if (!cancelled) {
          setReport(loaded);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(migrationErrorMessage(error, tRef.current('importExport.migration.preflight.errors.loadReport', { defaultValue: 'Failed to load the preflight report.' })));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingReport(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [details.migrationJobId, details.preflightedAt]);

  const handleRunPreflight = useCallback(async () => {
    setIsPreflighting(true);
    setActionError(null);
    try {
      const result = await preflightMigrationJob(details.migrationJobId);
      setReport(result);
      await onStateChanged();
    } catch (error) {
      setActionError(migrationErrorMessage(error, t('importExport.migration.preflight.errors.runFailed', { defaultValue: 'Preflight failed to run.' })));
      await onStateChanged();
    } finally {
      setIsPreflighting(false);
    }
  }, [details.migrationJobId, onStateChanged, t]);

  const handleRunMigration = useCallback(async () => {
    setIsExecuting(true);
    setActionError(null);
    try {
      await executeMigrationJob(details.migrationJobId);
      await onStateChanged();
    } catch (error) {
      setActionError(migrationErrorMessage(error, t('importExport.migration.preflight.errors.startMigration', { defaultValue: 'Failed to start the migration.' })));
    } finally {
      setIsExecuting(false);
    }
  }, [details.migrationJobId, onStateChanged, t]);

  const handleDownloadCsv = useCallback(async () => {
    setIsDownloading(true);
    setActionError(null);
    try {
      const csv = await getMigrationReportCsv(details.migrationJobId, 'preflight');
      downloadTextFile(`preflight-${details.migrationJobId}.csv`, csv, 'text/csv');
    } catch (error) {
      setActionError(migrationErrorMessage(error, t('importExport.migration.preflight.errors.downloadCsv', { defaultValue: 'Failed to download the preflight CSV.' })));
    } finally {
      setIsDownloading(false);
    }
  }, [details.migrationJobId, t]);

  const handleDownloadJson = useCallback(async () => {
    setIsDownloading(true);
    setActionError(null);
    try {
      const latest = await getMigrationPreflightReport(details.migrationJobId);
      downloadTextFile(
        `preflight-${details.migrationJobId}.json`,
        JSON.stringify(latest, null, 2),
        'application/json'
      );
    } catch (error) {
      setActionError(migrationErrorMessage(error, t('importExport.migration.preflight.errors.downloadJson', { defaultValue: 'Failed to download the preflight JSON.' })));
    } finally {
      setIsDownloading(false);
    }
  }, [details.migrationJobId, t]);

  const blockingIssues = useMemo(
    () => (report?.issues ?? []).filter((issue) => issue.severity === 'blocking'),
    [report]
  );
  const warningIssues = useMemo(
    () => (report?.issues ?? []).filter((issue) => issue.severity === 'warning'),
    [report]
  );

  const isPreflightRunning = isPreflighting || details.state === 'preflighting';
  const canRunMigration = details.state === 'ready' && !isExecuting && !isPreflightRunning;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('importExport.migration.preflight.title', { defaultValue: 'Preflight' })}</h3>
          <p className="text-sm text-muted-foreground">
            {t('importExport.migration.preflight.description', { defaultValue: 'A dry run that validates every staged record against this tenant and your configuration. Nothing is created by preflight.' })}
          </p>
        </div>
        <Button
          id="amp-run-preflight-button"
          variant="outline"
          onClick={() => void handleRunPreflight()}
          disabled={isPreflightRunning || isExecuting}
          className="w-full md:w-auto"
        >
          {isPreflightRunning ? (
            <span className="flex items-center gap-2">
              <Spinner size="sm" />
              {t('importExport.migration.preflight.running', { defaultValue: 'Preflight running…' })}
            </span>
          ) : report ? (
            t('importExport.migration.preflight.runAgain', { defaultValue: 'Run preflight again' })
          ) : (
            t('importExport.migration.preflight.run', { defaultValue: 'Run preflight' })
          )}
        </Button>
      </div>

      {actionError && (
        <Alert variant="destructive">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}
      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {isLoadingReport ? (
        <div className="flex h-32 items-center justify-center">
          <Spinner size="md" />
        </div>
      ) : !report ? (
        <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          {t('importExport.migration.preflight.empty', { defaultValue: 'No preflight has run for this configuration yet. Run preflight to see the per-entity plan and any issues.' })}
        </p>
      ) : (
        <>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-medium text-foreground">
                {t('importExport.migration.preflight.plan', { defaultValue: 'Plan' })}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {t('importExport.migration.preflight.preflightedAt', { defaultValue: 'Preflighted {{timestamp}}', timestamp: formatMigrationTimestamp(report.preflightedAt) })}
                </span>
              </h4>
              <div className="flex gap-2">
                <Button
                  id="amp-download-preflight-csv-button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleDownloadCsv()}
                  disabled={isDownloading}
                >
                  {t('importExport.migration.preflight.downloadCsv', { defaultValue: 'Download CSV' })}
                </Button>
                <Button
                  id="amp-download-preflight-json-button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleDownloadJson()}
                  disabled={isDownloading}
                >
                  {t('importExport.migration.preflight.downloadJson', { defaultValue: 'Download JSON' })}
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('importExport.migration.preflight.columns.entity', { defaultValue: 'Entity' })}</TableHead>
                    <TableHead className="text-right">{t('importExport.migration.preflight.columns.staged', { defaultValue: 'Staged' })}</TableHead>
                    <TableHead className="text-right">{t('importExport.migration.preflight.columns.toCreate', { defaultValue: 'To create' })}</TableHead>
                    <TableHead className="text-right">{t('importExport.migration.preflight.columns.toSkip', { defaultValue: 'To skip (already migrated)' })}</TableHead>
                    <TableHead className="text-right">{t('importExport.migration.preflight.columns.blocked', { defaultValue: 'Blocked' })}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.plan.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                        {t('importExport.migration.preflight.noStagedRecords', { defaultValue: 'The package staged no records.' })}
                      </TableCell>
                    </TableRow>
                  ) : (
                    report.plan.map((entityPlan) => (
                      <TableRow key={entityPlan.entityType}>
                        <TableCell className="font-medium text-foreground">
                          {migrationEntityLabel(entityPlan.entityType)}
                        </TableCell>
                        <TableCell className="text-right">{entityPlan.stagedCount}</TableCell>
                        <TableCell className="text-right">{entityPlan.toCreate}</TableCell>
                        <TableCell className="text-right">{entityPlan.toSkipIdentityMapped}</TableCell>
                        <TableCell
                          className={`text-right ${entityPlan.blocked > 0 ? 'font-medium text-destructive' : ''}`}
                        >
                          {entityPlan.blocked}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <IssueList
            title={t('importExport.migration.preflight.blockingIssues', { defaultValue: 'Blocking issues ({{count}})', count: blockingIssues.length })}
            issues={blockingIssues}
            severity="blocking"
          />
          <IssueList
            title={t('importExport.migration.preflight.warnings', { defaultValue: 'Warnings ({{count}})', count: warningIssues.length })}
            issues={warningIssues}
            severity="warning"
          />
        </>
      )}

      <div className="flex flex-col items-end gap-2 border-t border-border pt-4">
        {details.state === 'blocked' && (
          <p className="text-sm text-destructive">
            {blockingIssues.length > 0
              ? t('importExport.migration.preflight.blockedWithIssues', { defaultValue: 'The migration cannot run: {{count}} blocking issues must be resolved first.', count: blockingIssues.length })
              : t('importExport.migration.preflight.blockedNoPreflight', { defaultValue: 'The migration cannot run until a preflight passes without blocking issues.' })}
          </p>
        )}
        {details.state === 'needs_configuration' && (
          <p className="text-sm text-muted-foreground">
            {t('importExport.migration.preflight.needsConfiguration', { defaultValue: 'The migration can run once a preflight of the saved configuration passes.' })}
          </p>
        )}
        <Button id="amp-run-migration-button" onClick={() => void handleRunMigration()} disabled={!canRunMigration}>
          {isExecuting ? (
            <span className="flex items-center gap-2">
              <Spinner size="sm" />
              {t('importExport.migration.preflight.starting', { defaultValue: 'Starting…' })}
            </span>
          ) : (
            t('importExport.migration.preflight.runMigration', { defaultValue: 'Run migration' })
          )}
        </Button>
      </div>
    </div>
  );
};

const IssueList = ({
  title,
  issues,
  severity,
}: {
  title: string;
  issues: PreflightIssue[];
  severity: 'blocking' | 'warning';
}): React.JSX.Element | null => {
  const { t } = useTranslation('msp/settings');
  if (issues.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <h4 className={`text-sm font-medium ${severity === 'blocking' ? 'text-destructive' : 'text-foreground'}`}>
        {title}
      </h4>
      <ul className="space-y-2">
        {issues.map((issue, index) => (
          <li
            key={`${issue.code}-${issue.entityType ?? 'all'}-${index}`}
            className="rounded-md border border-border bg-muted/40 p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={severity === 'blocking' ? 'error' : 'warning'} size="sm" className="font-mono">
                {issue.code}
              </Badge>
              {issue.entityType && (
                <Badge variant="outline" size="sm">
                  {migrationEntityLabel(issue.entityType)}
                </Badge>
              )}
              {typeof issue.recordCount === 'number' && (
                <span className="text-xs text-muted-foreground">
                  {t('importExport.migration.preflight.recordsAffected', { defaultValue: '{{count}} records affected', count: issue.recordCount })}
                </span>
              )}
            </div>
            <p className="mt-1 break-words text-sm text-foreground">{issue.message}</p>
            {issue.sampleRecordIds && issue.sampleRecordIds.length > 0 && (
              <p className="mt-1 break-all text-xs text-muted-foreground">
                {t('importExport.migration.preflight.sampleRecords', { defaultValue: 'Sample records:' })} {issue.sampleRecordIds.join(', ')}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default MigrationPreflightPanel;
