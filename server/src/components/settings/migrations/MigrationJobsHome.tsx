'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import Spinner from '@alga-psa/ui/components/Spinner';
import type { AmpDiagnostic } from '@alga-psa/migration-sdk';
import type { AmpEntityType } from '@alga-psa/migration-spec';
import { listMigrationJobs } from '@/lib/migrations/migrationActions';
import { MAX_MIGRATION_PACKAGE_BYTES, MIGRATION_PHASE_ORDER, type MigrationJobSummary } from '@/lib/migrations/types';
import {
  formatMigrationTimestamp,
  migrationEntityLabel,
  migrationErrorMessage,
  migrationStateBadge,
} from './migrationUi';

const MAX_PACKAGE_MEGABYTES = Math.round(MAX_MIGRATION_PACKAGE_BYTES / (1024 * 1024));
const AMP_DOCS_URL = 'https://github.com/nine-minds/alga-psa/tree/main/docs/reference/amp';

interface MigrationJobsHomeProps {
  onSelectJob: (migrationJobId: string) => void;
}

const MigrationJobsHome = ({ onSelectJob }: MigrationJobsHomeProps): React.JSX.Element => {
  const { t } = useTranslation('msp/settings');
  const [jobs, setJobs] = useState<MigrationJobSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isUploadOpen, setUploadOpen] = useState(false);

  const loadJobs = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) {
      setIsLoading(true);
    }
    setLoadError(null);
    try {
      setJobs(await listMigrationJobs());
    } catch (error) {
      setLoadError(migrationErrorMessage(error, 'Failed to load migration jobs.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadJobs(true);
  }, [loadJobs]);

  const handleUploaded = useCallback(
    (migrationJobId: string, rejected: boolean) => {
      void loadJobs(false);
      if (!rejected) {
        setUploadOpen(false);
        onSelectJob(migrationJobId);
      }
    },
    [loadJobs, onSelectJob]
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>Migrations</CardTitle>
            <CardDescription>
              Bring data from another PSA into Alga by uploading an AMP package or a CSV/XLSX spreadsheet.
              Each upload is inspected, configured, and preflighted before anything is created.
            </CardDescription>
          </div>
          <Button id="amp-upload-package-button" onClick={() => setUploadOpen(true)} className="w-full md:w-auto">
            {t('importExport.migration.actions.upload', { defaultValue: 'Upload package' })}
          </Button>
        </CardHeader>
        <CardContent>
          {loadError && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          )}

          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Spinner size="md" />
            </div>
          ) : jobs.length === 0 && !loadError ? (
            <MigrationsEmptyState />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Package</TableHead>
                  <TableHead>Source system</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead className="text-right">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => {
                  const badge = migrationStateBadge(job.state);
                  return (
                    <TableRow
                      key={job.migrationJobId}
                      onClick={() => onSelectJob(job.migrationJobId)}
                      className="cursor-pointer transition-colors hover:bg-muted/60"
                    >
                      <TableCell className="font-medium text-foreground">{job.sourceFileName}</TableCell>
                      <TableCell>{job.sourceSystem ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <JobEntitySummary job={job} />
                      </TableCell>
                      <TableCell className="text-right">{formatMigrationTimestamp(job.createdAt)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <UploadPackageDialog
        isOpen={isUploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={handleUploaded}
      />
    </div>
  );
};

const MigrationsEmptyState = (): React.JSX.Element => (
  <div className="rounded-md border border-dashed border-border px-6 py-10 text-center">
    <h3 className="text-sm font-semibold text-foreground">No migrations yet</h3>
    <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
      An Alga Migration Package (<span className="font-mono">.amp</span>) is a portable, validated
      archive of organizations, locations, contacts, tickets, comments, and assets exported from
      another system. Upload one to inspect its contents, map its reference data to this tenant,
      and run a preflighted, repeat-safe import.
    </p>
    <p className="mt-3 text-sm">
      <a
        id="amp-docs-link"
        href={AMP_DOCS_URL}
        target="_blank"
        rel="noreferrer"
        className="font-medium text-primary-500 underline-offset-4 hover:underline"
      >
        Read the AMP package reference
      </a>
    </p>
  </div>
);

const JobEntitySummary = ({ job }: { job: MigrationJobSummary }): React.JSX.Element => {
  const parts = MIGRATION_PHASE_ORDER.flatMap((entityType: AmpEntityType) => {
    const progress = job.entityCounts[entityType];
    return progress ? [{ entityType, progress }] : [];
  });

  if (parts.length === 0) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {parts.map(({ entityType, progress }) => (
        <span key={entityType} className="whitespace-nowrap">
          <span className="font-medium text-foreground">{migrationEntityLabel(entityType)}</span>{' '}
          {progress.appliedCount}/{progress.plannedCount}
          {progress.failedCount > 0 && (
            <span className="text-destructive"> ({progress.failedCount} failed)</span>
          )}
        </span>
      ))}
    </div>
  );
};

interface UploadPackageDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onUploaded: (migrationJobId: string, rejected: boolean) => void;
}

const UploadPackageDialog = ({ isOpen, onClose, onUploaded }: UploadPackageDialogProps): React.JSX.Element => {
  const [file, setFile] = useState<File | null>(null);
  const [entityType, setEntityType] = useState<AmpEntityType>('assets');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [rejectionDiagnostics, setRejectionDiagnostics] = useState<AmpDiagnostic[] | null>(null);

  const resetAndClose = useCallback(() => {
    if (isUploading) {
      return;
    }
    setFile(null);
    setUploadError(null);
    setRejectionDiagnostics(null);
    onClose();
  }, [isUploading, onClose]);

  const handleUpload = useCallback(async () => {
    if (!file) {
      return;
    }
    if (file.size > MAX_MIGRATION_PACKAGE_BYTES) {
      setUploadError(`Migration packages must be ${MAX_PACKAGE_MEGABYTES} MB or smaller.`);
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    setRejectionDiagnostics(null);
    try {
      const spreadsheet = /\.(csv|xlsx)$/i.test(file.name);
      const response = await fetch(spreadsheet ? '/api/migrations/spreadsheet' : '/api/migrations/upload', {
        method: 'POST',
        headers: {
          'content-type': file.type || 'application/vnd.sqlite3',
          'x-amp-file-size': String(file.size),
          'x-amp-file-name': encodeURIComponent(file.name),
          ...(spreadsheet ? { 'x-amp-entity-type': entityType } : {}),
        },
        body: file,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to upload the package.');
      if (result.state === 'rejected') {
        setRejectionDiagnostics(result.diagnostics);
        onUploaded(result.migrationJobId, true);
      } else {
        setFile(null);
        onUploaded(result.migrationJobId, false);
      }
    } catch (error) {
      setUploadError(migrationErrorMessage(error, 'Failed to upload the package.'));
    } finally {
      setIsUploading(false);
    }
  }, [entityType, file, onUploaded]);

  return (
    <Dialog id="amp-upload-package-dialog" isOpen={isOpen} onClose={resetAndClose} title="Upload migration package">
      <DialogContent>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="amp-package-file-input">Package or spreadsheet</Label>
            <Input
              id="amp-package-file-input"
              type="file"
              accept=".amp,.csv,.xlsx"
              disabled={isUploading}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setUploadError(null);
                setRejectionDiagnostics(null);
              }}
            />
            <p className="text-xs text-muted-foreground">
              AMP (.amp) or CSV/XLSX, up to {MAX_PACKAGE_MEGABYTES} MB. Spreadsheets become an AMP
              package before staging; nothing is imported until you run the migration.
            </p>
          </div>
          {file && /\.(csv|xlsx)$/i.test(file.name) && (
            <div className="space-y-2">
              <Label htmlFor="amp-spreadsheet-entity">Spreadsheet records represent</Label>
              <CustomSelect id="amp-spreadsheet-entity" value={entityType} onValueChange={(value) => setEntityType(value as AmpEntityType)} disabled={isUploading} options={[
                { value: 'assets', label: 'Assets (legacy asset import)' }, { value: 'organizations', label: 'Organizations' }, { value: 'locations', label: 'Locations' }, { value: 'contacts', label: 'Contacts' }, { value: 'tickets', label: 'Tickets' }, { value: 'ticket_comments', label: 'Ticket comments' },
              ]} />
              <p className="text-xs text-muted-foreground">Canonical headers are recognized automatically. Legacy asset names such as Asset Name, Asset Type, Serial Number, and MAC Address are preserved through the AMP flow.</p>
            </div>
          )}

          {uploadError && (
            <Alert variant="destructive">
              <AlertDescription>{uploadError}</AlertDescription>
            </Alert>
          )}

          {rejectionDiagnostics && (
            <Alert variant="destructive">
              <AlertDescription>
                <span className="font-medium">
                  The package was rejected and nothing was staged. Fix these problems in the source
                  package and upload it again:
                </span>
                <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto pl-1 text-sm">
                  {rejectionDiagnostics.map((diagnostic, index) => (
                    <li key={`${diagnostic.code}-${index}`} className="flex items-start gap-2">
                      <Badge variant="outline" size="sm" className="mt-0.5 shrink-0 font-mono">
                        {diagnostic.code}
                      </Badge>
                      <span className="break-words">
                        {diagnostic.message}
                        {diagnostic.table ? ` (table: ${diagnostic.table})` : ''}
                        {diagnostic.recordId ? ` (record: ${diagnostic.recordId})` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </div>
      </DialogContent>
      <DialogFooter>
        <Button id="amp-upload-cancel-button" variant="outline" onClick={resetAndClose} disabled={isUploading}>
          {rejectionDiagnostics ? 'Close' : 'Cancel'}
        </Button>
        <Button id="amp-upload-submit-button" onClick={() => void handleUpload()} disabled={!file || isUploading}>
          {isUploading ? (
            <span className="flex items-center gap-2">
              <Spinner size="sm" />
              Uploading…
            </span>
          ) : (
            'Upload'
          )}
        </Button>
      </DialogFooter>
    </Dialog>
  );
};

export default MigrationJobsHome;
