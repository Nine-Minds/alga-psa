'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
          setLoadError(migrationErrorMessage(error, 'Failed to load the preflight report.'));
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
      setActionError(migrationErrorMessage(error, 'Preflight failed to run.'));
      await onStateChanged();
    } finally {
      setIsPreflighting(false);
    }
  }, [details.migrationJobId, onStateChanged]);

  const handleRunMigration = useCallback(async () => {
    setIsExecuting(true);
    setActionError(null);
    try {
      await executeMigrationJob(details.migrationJobId);
      await onStateChanged();
    } catch (error) {
      setActionError(migrationErrorMessage(error, 'Failed to start the migration.'));
    } finally {
      setIsExecuting(false);
    }
  }, [details.migrationJobId, onStateChanged]);

  const handleDownloadCsv = useCallback(async () => {
    setIsDownloading(true);
    setActionError(null);
    try {
      const csv = await getMigrationReportCsv(details.migrationJobId, 'preflight');
      downloadTextFile(`preflight-${details.migrationJobId}.csv`, csv, 'text/csv');
    } catch (error) {
      setActionError(migrationErrorMessage(error, 'Failed to download the preflight CSV.'));
    } finally {
      setIsDownloading(false);
    }
  }, [details.migrationJobId]);

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
      setActionError(migrationErrorMessage(error, 'Failed to download the preflight JSON.'));
    } finally {
      setIsDownloading(false);
    }
  }, [details.migrationJobId]);

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
          <h3 className="text-sm font-semibold text-foreground">Preflight</h3>
          <p className="text-sm text-muted-foreground">
            A dry run that validates every staged record against this tenant and your
            configuration. Nothing is created by preflight.
          </p>
        </div>
        <Button
          id="amp-run-preflight-button"
          variant="outline"
          onClick={handleRunPreflight}
          disabled={isPreflightRunning || isExecuting}
          className="w-full md:w-auto"
        >
          {isPreflightRunning ? (
            <span className="flex items-center gap-2">
              <Spinner size="sm" />
              Preflight running…
            </span>
          ) : report ? (
            'Run preflight again'
          ) : (
            'Run preflight'
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
          No preflight has run for this configuration yet. Run preflight to see the per-entity plan
          and any issues.
        </p>
      ) : (
        <>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-medium text-foreground">
                Plan
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  Preflighted {formatMigrationTimestamp(report.preflightedAt)}
                </span>
              </h4>
              <div className="flex gap-2">
                <Button
                  id="amp-download-preflight-csv-button"
                  variant="ghost"
                  size="sm"
                  onClick={handleDownloadCsv}
                  disabled={isDownloading}
                >
                  Download CSV
                </Button>
                <Button
                  id="amp-download-preflight-json-button"
                  variant="ghost"
                  size="sm"
                  onClick={handleDownloadJson}
                  disabled={isDownloading}
                >
                  Download JSON
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Entity</TableHead>
                    <TableHead className="text-right">Staged</TableHead>
                    <TableHead className="text-right">To create</TableHead>
                    <TableHead className="text-right">To skip (already migrated)</TableHead>
                    <TableHead className="text-right">Blocked</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.plan.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                        The package staged no records.
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
            title={`Blocking issues (${blockingIssues.length})`}
            issues={blockingIssues}
            severity="blocking"
          />
          <IssueList
            title={`Warnings (${warningIssues.length})`}
            issues={warningIssues}
            severity="warning"
          />
        </>
      )}

      <div className="flex flex-col items-end gap-2 border-t border-border pt-4">
        {details.state === 'blocked' && (
          <p className="text-sm text-destructive">
            {blockingIssues.length > 0
              ? `The migration cannot run: ${blockingIssues.length} blocking issue${
                  blockingIssues.length === 1 ? '' : 's'
                } must be resolved first.`
              : 'The migration cannot run until a preflight passes without blocking issues.'}
          </p>
        )}
        {details.state === 'needs_configuration' && (
          <p className="text-sm text-muted-foreground">
            The migration can run once a preflight of the saved configuration passes.
          </p>
        )}
        <Button id="amp-run-migration-button" onClick={handleRunMigration} disabled={!canRunMigration}>
          {isExecuting ? (
            <span className="flex items-center gap-2">
              <Spinner size="sm" />
              Starting…
            </span>
          ) : (
            'Run migration'
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
                  {issue.recordCount} record{issue.recordCount === 1 ? '' : 's'} affected
                </span>
              )}
            </div>
            <p className="mt-1 break-words text-sm text-foreground">{issue.message}</p>
            {issue.sampleRecordIds && issue.sampleRecordIds.length > 0 && (
              <p className="mt-1 break-all text-xs text-muted-foreground">
                Sample records: {issue.sampleRecordIds.join(', ')}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default MigrationPreflightPanel;
