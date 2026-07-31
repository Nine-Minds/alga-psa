'use client';

import React from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Switch } from '@alga-psa/ui/components/Switch';
import {
  previewQboItemImport,
  executeQboItemImport,
} from '../../actions/qboItemImportActions';
import type {
  QboItemImportPreview,
  QboItemImportPreviewRow,
  QboItemImportResult,
} from '../../services/accountingSync/qboItemImportService';
import { getServiceTypesForSelection } from '../../actions/serviceActions';

/**
 * Optional wizard step: bulk import of QBO Products & Services into the
 * service catalog. Preview shows the exact per-row plan (incl. flags and
 * per-field diffs) before anything is written. Skippable — the wizard's
 * Next button is always available.
 */

const BILLING_METHOD_OPTIONS = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'usage', label: 'Usage' },
] as const;

type BillingMethod = 'fixed' | 'hourly' | 'usage';

const FLAG_LABELS: Record<string, string> = {
  inactive: 'Inactive in QuickBooks',
  unmapped_tax: 'Tax code not mapped',
  sku_conflict: 'SKU conflict',
  name_collision: 'Name already mapped',
  category_skipped: 'Category (not imported)',
};

const ACTION_LABELS: Record<QboItemImportPreviewRow['action'], string> = {
  create: 'Will create',
  update: 'Will update',
  link: 'Will link',
  skip: 'Skipped',
};

function centsToDisplay(value: unknown): string {
  if (typeof value !== 'number') return String(value ?? '—');
  return (value / 100).toFixed(2);
}

function formatChangeValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'default_rate' || field === 'cost') return centsToDisplay(value);
  return String(value);
}

function RowFlags({ flags }: { flags: QboItemImportPreviewRow['flags'] }) {
  if (flags.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {flags.map((flag) => (
        <Badge key={flag} variant="secondary" className="text-xs">
          {FLAG_LABELS[flag] ?? flag}
        </Badge>
      ))}
    </span>
  );
}

function PreviewGroup({ title, rows }: { title: string; rows: QboItemImportPreviewRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">
        {title} <span className="text-muted-foreground">({rows.length})</span>
      </p>
      <div className="rounded-md border divide-y">
        {rows.map((row) => (
          <div key={row.qboItemId} className="p-2 text-sm space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{row.qboName}</span>
              <span className="text-xs text-muted-foreground">{row.qboType}</span>
              <RowFlags flags={row.flags} />
            </div>
            {row.qboFullyQualifiedName && row.qboFullyQualifiedName !== row.qboName && (
              <p className="text-xs text-muted-foreground">
                QuickBooks name: {row.qboFullyQualifiedName} (imported as “{row.fields?.service_name ?? row.qboName}”)
              </p>
            )}
            {row.reason && <p className="text-xs text-muted-foreground">{row.reason}</p>}
            {row.action === 'update' && row.fieldChanges && row.fieldChanges.length > 0 && (
              <ul className="text-xs text-muted-foreground list-disc pl-4">
                {row.fieldChanges.map((change) => (
                  <li key={change.field}>
                    {change.field}: {formatChangeValue(change.field, change.from)} →{' '}
                    {formatChangeValue(change.field, change.to)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function QboItemImportStep() {
  const [serviceTypes, setServiceTypes] = React.useState<Array<{ id: string; name: string }>>([]);
  const [serviceTypeId, setServiceTypeId] = React.useState('');
  const [serviceBillingMethod, setServiceBillingMethod] = React.useState<BillingMethod>('fixed');
  const [productBillingMethod, setProductBillingMethod] = React.useState<BillingMethod>('fixed');
  const [unitOfMeasure, setUnitOfMeasure] = React.useState('Unit');
  const [includeInactive, setIncludeInactive] = React.useState(true);

  const [previewing, setPreviewing] = React.useState(false);
  const [preview, setPreview] = React.useState<QboItemImportPreview | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);

  const [executing, setExecuting] = React.useState(false);
  const [result, setResult] = React.useState<QboItemImportResult | null>(null);
  const [executeError, setExecuteError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const types = await getServiceTypesForSelection();
        if (!cancelled && Array.isArray(types)) {
          setServiceTypes(types);
        }
      } catch {
        // Preview surfaces a clearer error when a type is required but missing.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const options = () => ({
    includeInactive,
    defaults: {
      serviceTypeId,
      serviceBillingMethod,
      productBillingMethod,
      unitOfMeasure: unitOfMeasure.trim() || 'Unit',
    },
  });

  const handlePreview = async () => {
    setPreviewing(true);
    setPreviewError(null);
    setPreview(null);
    setResult(null);
    setExecuteError(null);
    try {
      setPreview(await previewQboItemImport(options()));
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Failed to load the import preview.');
    } finally {
      setPreviewing(false);
    }
  };

  const handleExecute = async () => {
    setExecuting(true);
    setExecuteError(null);
    try {
      setResult(await executeQboItemImport(options()));
      setPreview(null);
    } catch (err) {
      setExecuteError(err instanceof Error ? err.message : 'The import failed.');
    } finally {
      setExecuting(false);
    }
  };

  const rowsByAction = (action: QboItemImportPreviewRow['action']) =>
    preview?.rows.filter((row) => row.action === action) ?? [];

  return (
    <div id="qbo-item-import-step" className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Import your QuickBooks products and services into the Alga service catalog for the
        connected QuickBooks company. QuickBooks stays the source of truth for names, rates,
        SKUs, descriptions, and costs; billing method, unit of measure, and service type are
        set here and owned by Alga afterwards. This step is optional — skip it with Next.
      </p>

      {/* Defaults for created items */}
      <div className="rounded-lg border p-4 space-y-4 text-sm">
        <p className="font-medium text-foreground">Defaults for imported items</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="qbo-item-import-service-type">Service type (required)</Label>
            <CustomSelect
              id="qbo-item-import-service-type"
              value={serviceTypeId}
              onValueChange={setServiceTypeId}
              placeholder="Select a service type…"
              options={serviceTypes.map((type) => ({ value: type.id, label: type.name }))}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="qbo-item-import-uom">Unit of measure</Label>
            <Input
              id="qbo-item-import-uom"
              value={unitOfMeasure}
              onChange={(e) => setUnitOfMeasure(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="qbo-item-import-service-billing">Billing method for services</Label>
            <CustomSelect
              id="qbo-item-import-service-billing"
              value={serviceBillingMethod}
              onValueChange={(value) => setServiceBillingMethod(value as BillingMethod)}
              options={[...BILLING_METHOD_OPTIONS]}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="qbo-item-import-product-billing">Billing method for products</Label>
            <CustomSelect
              id="qbo-item-import-product-billing"
              value={productBillingMethod}
              onValueChange={(value) => setProductBillingMethod(value as BillingMethod)}
              options={[...BILLING_METHOD_OPTIONS]}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="qbo-item-import-include-inactive"
            checked={includeInactive}
            onCheckedChange={setIncludeInactive}
          />
          <Label htmlFor="qbo-item-import-include-inactive">
            Include inactive QuickBooks items (imported as inactive)
          </Label>
        </div>

        <Button
          id="qbo-item-import-preview"
          type="button"
          disabled={previewing || !serviceTypeId}
          onClick={handlePreview}
        >
          {previewing ? 'Loading preview…' : 'Preview import'}
        </Button>
        {!serviceTypeId && (
          <p className="text-xs text-muted-foreground">Choose a service type to enable the preview.</p>
        )}
      </div>

      {previewError && (
        <Alert variant="destructive" id="qbo-item-import-preview-error">
          <AlertDescription>{previewError}</AlertDescription>
        </Alert>
      )}

      {preview && (
        <div id="qbo-item-import-preview-panel" className="space-y-4">
          <p className="text-sm">
            Found <span className="font-medium">{preview.totalQboItems}</span> QuickBooks items for
            the connected company (realm {preview.realm}): {preview.summary.create} to create,{' '}
            {preview.summary.update} to update, {preview.summary.link} to link,{' '}
            {preview.summary.skip} skipped. Nothing has been written yet.
          </p>

          <PreviewGroup title="Will create" rows={rowsByAction('create')} />
          <PreviewGroup title="Will update" rows={rowsByAction('update')} />
          <PreviewGroup title="Will link (already matching)" rows={rowsByAction('link')} />
          <PreviewGroup title="Skipped" rows={rowsByAction('skip')} />

          <Button
            id="qbo-item-import-execute"
            type="button"
            disabled={executing || preview.summary.create + preview.summary.update + preview.summary.link === 0}
            onClick={handleExecute}
          >
            {executing ? 'Importing…' : 'Run import'}
          </Button>
        </div>
      )}

      {executeError && (
        <Alert variant="destructive" id="qbo-item-import-execute-error">
          <AlertDescription>{executeError}</AlertDescription>
        </Alert>
      )}

      {result && (
        <Alert id="qbo-item-import-result">
          <AlertDescription>
            Import complete: {result.created} created, {result.updated} updated, {result.linked}{' '}
            linked, {result.skipped} skipped
            {result.errors.length > 0 ? `, ${result.errors.length} failed` : ''}.
            {result.errors.length > 0 && (
              <ul className="mt-2 list-disc pl-4 text-xs">
                {result.errors.map((error) => (
                  <li key={error.qboItemId}>
                    {error.qboName}: {error.message}
                  </li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
