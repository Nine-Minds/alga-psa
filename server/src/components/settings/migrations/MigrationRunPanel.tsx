'use client';

import { useCallback, useState } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import Spinner from '@alga-psa/ui/components/Spinner';
import type { AmpEntityType } from '@alga-psa/migration-spec';
import { cancelMigrationJob } from '@/lib/migrations/migrationActions';
import { MIGRATION_PHASE_ORDER, type MigrationJobDetails } from '@/lib/migrations/types';
import { migrationEntityLabel, migrationErrorMessage } from './migrationUi';

interface MigrationRunPanelProps {
  details: MigrationJobDetails;
  /** Called after a cancel request so the parent refreshes job state. */
  onStateChanged: () => Promise<void> | void;
}

/**
 * Live progress while the job is queued or applying. Progress is reported per
 * entity per phase — applied/skipped/failed of planned — deliberately never as
 * a single overall percentage. The parent polls and re-renders this panel.
 */
const MigrationRunPanel = ({ details, onStateChanged }: MigrationRunPanelProps): React.JSX.Element => {
  const { t } = useTranslation('msp/settings');
  const [isCancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const handleCancel = useCallback(async () => {
    setIsCancelling(true);
    setCancelError(null);
    try {
      await cancelMigrationJob(details.migrationJobId);
      setCancelDialogOpen(false);
      await onStateChanged();
    } catch (error) {
      setCancelError(migrationErrorMessage(error, 'Failed to request cancellation.'));
    } finally {
      setIsCancelling(false);
    }
  }, [details.migrationJobId, onStateChanged]);

  const stagedEntities = MIGRATION_PHASE_ORDER.flatMap((entityType: AmpEntityType) => {
    const progress = details.entityCounts[entityType];
    return progress ? [{ entityType, progress }] : [];
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3">
          <Spinner size="sm" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {details.state === 'queued'
                ? t('importExport.migration.run.queued', { defaultValue: 'Migration queued' })
                : t('importExport.migration.run.applying', { defaultValue: 'Migration in progress' })}
            </h3>
            <p className="text-sm text-muted-foreground">
              Entities are applied in dependency order, one phase at a time. This view refreshes
              automatically every few seconds.
            </p>
          </div>
        </div>
        <Button
          id="amp-cancel-migration-button"
          variant="destructive"
          onClick={() => setCancelDialogOpen(true)}
          disabled={isCancelling}
          className="w-full md:w-auto"
        >
          Cancel migration
        </Button>
      </div>

      {cancelError && (
        <Alert variant="destructive">
          <AlertDescription>{cancelError}</AlertDescription>
        </Alert>
      )}

      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Phase</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>State</TableHead>
              <TableHead className="text-right">Applied</TableHead>
              <TableHead className="text-right">Skipped</TableHead>
              <TableHead className="text-right">Failed</TableHead>
              <TableHead className="text-right">Planned</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stagedEntities.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                  Waiting for the worker to report per-entity progress…
                </TableCell>
              </TableRow>
            ) : (
              stagedEntities.map(({ entityType, progress }) => {
                return (
                  <TableRow key={entityType}>
                    <TableCell className="tabular-nums">{progress.phase}</TableCell>
                    <TableCell className="font-medium text-foreground">
                      {migrationEntityLabel(entityType)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="default-muted" size="sm" className="capitalize">
                        {progress.state.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{progress.appliedCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{progress.skippedCount}</TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${progress.failedCount > 0 ? 'font-medium text-destructive' : ''}`}
                    >
                      {progress.failedCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{progress.plannedCount}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <ConfirmationDialog
        id="amp-cancel-migration-dialog"
        isOpen={isCancelDialogOpen}
        onClose={() => setCancelDialogOpen(false)}
        onConfirm={handleCancel}
        isConfirming={isCancelling}
        title="Cancel this migration?"
        message="The worker stops at the next checkpoint. Records already applied stay in place and are reported in the results; nothing is rolled back."
        confirmLabel="Cancel migration"
        cancelLabel="Keep running"
      />
    </div>
  );
};

export default MigrationRunPanel;
