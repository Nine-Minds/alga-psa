'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  migrationOutcomeBadge,
  migrationUploadErrorCopy,
} from './migrationUi';

const MAX_PACKAGE_MEGABYTES = Math.round(MAX_MIGRATION_PACKAGE_BYTES / (1024 * 1024));
const AMP_DOCS_URL = 'https://github.com/nine-minds/alga-psa/tree/main/docs/reference/amp';

interface MigrationJobsHomeProps {
  onSelectJob: (migrationJobId: string) => void;
}

const MigrationJobsHome = ({ onSelectJob }: MigrationJobsHomeProps): React.JSX.Element => {
  const { t } = useTranslation('msp/settings');
  // Loaders read the latest translator through a ref so a new `t` (namespace load,
  // language switch) never re-triggers the fetch.
  const tRef = useRef(t);
  tRef.current = t;
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
      setLoadError(migrationErrorMessage(error, tRef.current('importExport.migration.errors.loadJobs', { defaultValue: 'Failed to load migration jobs.' })));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadJobs(true);
  }, [loadJobs]);

  const handleUploaded = useCallback(
    (migrationJobId: string, rejected: boolean) => {
      if (!rejected) {
        setUploadOpen(false);
        onSelectJob(migrationJobId);
        return;
      }

      void loadJobs(false);
    },
    [loadJobs, onSelectJob]
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>{t('importExport.migration.home.title', { defaultValue: 'Migrations' })}</CardTitle>
            <CardDescription>
              {t('importExport.migration.home.description', { defaultValue: 'Bring data from another PSA into Alga by uploading an AMP package or a CSV/XLSX spreadsheet. Each upload is inspected, configured, and preflighted before anything is created.' })}
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
                  <TableHead>{t('importExport.migration.home.columns.package', { defaultValue: 'Package' })}</TableHead>
                  <TableHead>{t('importExport.migration.home.columns.sourceSystem', { defaultValue: 'Source system' })}</TableHead>
                  <TableHead>{t('importExport.migration.home.columns.state', { defaultValue: 'State' })}</TableHead>
                  <TableHead>{t('importExport.migration.home.columns.progress', { defaultValue: 'Progress' })}</TableHead>
                  <TableHead className="text-right">{t('importExport.migration.home.columns.created', { defaultValue: 'Created' })}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => {
                  const badge = migrationOutcomeBadge(job.state, job.entityCounts, t);
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

const MigrationsEmptyState = (): React.JSX.Element => {
  const { t } = useTranslation('msp/settings');
  return (
    <div className="rounded-md border border-dashed border-border px-6 py-10 text-center">
      <h3 className="text-sm font-semibold text-foreground">{t('importExport.migration.home.empty.title', { defaultValue: 'No migrations yet' })}</h3>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
        {t('importExport.migration.home.empty.descriptionPrefix', { defaultValue: 'An Alga Migration Package (' })}<span className="font-mono">.amp</span>{t('importExport.migration.home.empty.descriptionSuffix', { defaultValue: ') is a portable, validated archive of organizations, locations, contacts, tickets, comments, and assets exported from another system. Upload one to inspect its contents, map its reference data to this tenant, and run a preflighted, repeat-safe import.' })}
      </p>
      <p className="mt-3 text-sm">
        <a
          id="amp-docs-link"
          href={AMP_DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-primary-500 underline-offset-4 hover:underline"
        >
          {t('importExport.migration.home.empty.docsLink', { defaultValue: 'Read the AMP package reference' })}
        </a>
      </p>
    </div>
  );
};

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
  const { t } = useTranslation('msp/settings');
  const [file, setFile] = useState<File | null>(null);
  const [entityType, setEntityType] = useState<AmpEntityType>('assets');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [rejectionDiagnostics, setRejectionDiagnostics] = useState<AmpDiagnostic[] | null>(null);
  const [stageDiagnostics, setStageDiagnostics] = useState<Array<{ code: string; message: string }> | null>(null);
  const [stagedJobId, setStagedJobId] = useState<string | null>(null);

  const resetUploadState = useCallback(() => {
    setFile(null);
    setUploadError(null);
    setRejectionDiagnostics(null);
    setStageDiagnostics(null);
    setStagedJobId(null);
  }, []);

  const resetAndClose = useCallback(() => {
    if (isUploading) {
      return;
    }
    resetUploadState();
    onClose();
  }, [isUploading, onClose, resetUploadState]);

  const continueToStagedJob = useCallback(() => {
    const jobId = stagedJobId;
    resetUploadState();
    if (jobId) {
      onUploaded(jobId, false);
    }
  }, [onUploaded, resetUploadState, stagedJobId]);

  const handleUpload = useCallback(async () => {
    if (!file) {
      return;
    }
    if (file.size > MAX_MIGRATION_PACKAGE_BYTES) {
      setUploadError(t('importExport.migration.upload.tooLarge', { defaultValue: 'Migration packages must be {{megabytes}} MB or smaller.', megabytes: MAX_PACKAGE_MEGABYTES }));
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    setRejectionDiagnostics(null);
    setStageDiagnostics(null);
    setStagedJobId(null);
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
      if (!response.ok) {
        const copy = migrationUploadErrorCopy(typeof result.error === 'string' ? result.error : '');
        setUploadError(t(copy.key, { defaultValue: copy.defaultValue }));
        return;
      }
      if (result.state === 'rejected') {
        setRejectionDiagnostics(result.diagnostics);
        onUploaded(result.migrationJobId, true);
        return;
      }
      // Surface conversion diagnostics after a successful stage so an ignored
      // client or name column is visible before the user reaches apply.
      const conversionDiagnostics = Array.isArray(result.conversionDiagnostics)
        ? result.conversionDiagnostics.filter(
            (diagnostic: { code?: unknown; message?: unknown }) =>
              typeof diagnostic?.message === 'string' && diagnostic.message.length > 0
          )
        : [];
      if (conversionDiagnostics.length > 0) {
        setStageDiagnostics(conversionDiagnostics);
        setStagedJobId(result.migrationJobId);
        return;
      }
      setFile(null);
      onUploaded(result.migrationJobId, false);
    } catch {
      const copy = migrationUploadErrorCopy('AMP_UPLOAD_FAILED');
      setUploadError(t(copy.key, { defaultValue: copy.defaultValue }));
    } finally {
      setIsUploading(false);
    }
  }, [entityType, file, onUploaded, t]);

  return (
    <Dialog id="amp-upload-package-dialog" isOpen={isOpen} onClose={resetAndClose} title={t('importExport.migration.upload.title', { defaultValue: 'Upload migration package' })}>
      <DialogContent>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="amp-package-file-input">{t('importExport.migration.upload.fileLabel', { defaultValue: 'Package or spreadsheet' })}</Label>
            <Input
              id="amp-package-file-input"
              type="file"
              accept=".amp,.csv,.xlsx"
              disabled={isUploading}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setUploadError(null);
                setRejectionDiagnostics(null);
                setStageDiagnostics(null);
                setStagedJobId(null);
              }}
            />
            <p className="text-xs text-muted-foreground">
              {t('importExport.migration.upload.fileHint', { defaultValue: 'AMP (.amp) or CSV/XLSX, up to {{megabytes}} MB. Spreadsheets become an AMP package before staging; nothing is imported until you run the migration.', megabytes: MAX_PACKAGE_MEGABYTES })}
            </p>
          </div>
          {file && /\.(csv|xlsx)$/i.test(file.name) && (
            <div className="space-y-2">
              <Label htmlFor="amp-spreadsheet-entity">{t('importExport.migration.upload.entityLabel', { defaultValue: 'Spreadsheet records represent' })}</Label>
              <CustomSelect id="amp-spreadsheet-entity" value={entityType} onValueChange={(value) => setEntityType(value as AmpEntityType)} disabled={isUploading} options={[
                { value: 'assets', label: t('importExport.migration.spreadsheet.entities.assets', { defaultValue: 'Assets (legacy asset import)' }) }, { value: 'organizations', label: t('importExport.migration.spreadsheet.entities.organizations', { defaultValue: 'Organizations' }) }, { value: 'locations', label: t('importExport.migration.spreadsheet.entities.locations', { defaultValue: 'Locations' }) }, { value: 'contacts', label: t('importExport.migration.spreadsheet.entities.contacts', { defaultValue: 'Contacts' }) }, { value: 'tickets', label: t('importExport.migration.spreadsheet.entities.tickets', { defaultValue: 'Tickets' }) }, { value: 'ticket_comments', label: t('importExport.migration.spreadsheet.entities.ticketComments', { defaultValue: 'Ticket comments' }) },
                { value: 'products', label: t('importExport.migration.spreadsheet.entities.products', { defaultValue: 'Products (catalog / price list)' }) },
                { value: 'vendor_products', label: t('importExport.migration.spreadsheet.entities.vendorProducts', { defaultValue: 'Vendor price list (distributor costs)' }) },
              ]} />
              <p className="text-xs text-muted-foreground">{t('importExport.migration.spreadsheet.headersHint', { defaultValue: 'Canonical headers are recognized automatically. Other columns can be mapped to custom asset-type fields during Configure. Contacts accept common spellings such as Name, First Name, Last Name, Email, Phone, Title, and Client; legacy asset names such as Asset Name, Asset Type, and Serial Number are preserved through the AMP flow.' })}</p>
              {(entityType === 'products' || entityType === 'vendor_products') && (
                <p className="text-xs text-muted-foreground">{t('importExport.migration.spreadsheet.productsHint', { defaultValue: 'Prices and costs are read as decimal amounts (for example 1,299.50) using the currency column when present, otherwise the tenant currency. Negative, non-numeric or over-precise amounts are dropped and reported; the row is still imported. Products match existing products by SKU; vendor price-list rows reference a product by SKU and create or match the vendor by name.' })}</p>
              )}
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
                  {t('importExport.migration.upload.rejected', { defaultValue: 'The package was rejected and nothing was staged. Fix these problems in the source package and upload it again:' })}
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

          {stageDiagnostics && (
            <Alert>
              <AlertDescription>
                <span className="font-medium">
                  {t('importExport.migration.upload.stagedWithDiagnostics', { defaultValue: 'The package staged, but some source data needs your attention before you run the import:' })}
                </span>
                <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto pl-1 text-sm">
                  {stageDiagnostics.map((diagnostic, index) => (
                    <li key={`${diagnostic.code}-${index}`} className="flex items-start gap-2">
                      <Badge variant="outline" size="sm" className="mt-0.5 shrink-0 font-mono">
                        {diagnostic.code}
                      </Badge>
                      <span className="break-words">{diagnostic.message}</span>
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </div>
      </DialogContent>
      <DialogFooter>
        {stagedJobId ? (
          <Button id="amp-upload-continue-button" onClick={continueToStagedJob}>
            {t('importExport.migration.upload.continueToConfigure', { defaultValue: 'Continue to configure' })}
          </Button>
        ) : (
          <>
            <Button id="amp-upload-cancel-button" variant="outline" onClick={resetAndClose} disabled={isUploading}>
              {rejectionDiagnostics
                ? t('importExport.migration.actions.close', { defaultValue: 'Close' })
                : t('importExport.migration.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button id="amp-upload-submit-button" onClick={() => void handleUpload()} disabled={!file || isUploading}>
              {isUploading ? (
                <span className="flex items-center gap-2">
                  <Spinner size="sm" />
                  {t('importExport.migration.upload.uploading', { defaultValue: 'Uploading…' })}
                </span>
              ) : (
                t('importExport.migration.upload.submit', { defaultValue: 'Upload' })
              )}
            </Button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  );
};

export default MigrationJobsHome;
