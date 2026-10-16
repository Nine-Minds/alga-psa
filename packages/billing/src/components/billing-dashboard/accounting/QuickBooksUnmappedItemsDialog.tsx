'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type {
  QuickBooksMappingDecision,
  UnmappedQuickBooksEntity
} from '../../../actions/quickBooksExportMappingRules';

interface QuickBooksUnmappedItemsDialogProps {
  isOpen: boolean;
  adapterType: string;
  entities: UnmappedQuickBooksEntity[];
  canManageMappings: boolean;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (decisions: QuickBooksMappingDecision[]) => void;
}

type RowState = { mode: 'create' | 'existing'; name: string };

const rowKey = (entity: UnmappedQuickBooksEntity) => `${entity.algaEntityType}:${entity.algaEntityId}`;

/**
 * Shown when a QuickBooks Desktop or QuickBooks CSV batch stops on unmapped
 * clients, services/products or discounts. Each row is either created as new
 * in QuickBooks or linked to an existing entry by name; both save a mapping so
 * the next export does not ask again.
 */
export function QuickBooksUnmappedItemsDialog({
  isOpen,
  adapterType,
  entities,
  canManageMappings,
  saving,
  error,
  onCancel,
  onSubmit
}: QuickBooksUnmappedItemsDialogProps): React.JSX.Element {
  const { t } = useTranslation('msp/billing');
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const isDesktop = adapterType === 'quickbooks_desktop';

  useEffect(() => {
    if (!isOpen) return;
    setRows(Object.fromEntries(entities.map((entity) => [rowKey(entity), { mode: 'create', name: entity.proposedName }])));
  }, [entities, isOpen]);

  const mappingsHref = `/msp/settings?tab=integrations&category=accounting&accounting_integration=${isDesktop ? 'quickbooks_desktop' : 'quickbooks_csv'}`;

  const kindLabel = (entity: UnmappedQuickBooksEntity): string => {
    if (entity.algaEntityType === 'client') return t('accountingExports.unmapped.kinds.client', { defaultValue: 'Client' });
    if (entity.algaEntityType === 'discount') return t('accountingExports.unmapped.kinds.discount', { defaultValue: 'Discount' });
    return entity.itemKind === 'product'
      ? t('accountingExports.unmapped.kinds.product', { defaultValue: 'Product' })
      : t('accountingExports.unmapped.kinds.service', { defaultValue: 'Service' });
  };

  const invalidKeys = useMemo(() => {
    const invalid = new Set<string>();
    for (const entity of entities) {
      const row = rows[rowKey(entity)];
      const name = row?.name.trim() ?? '';
      if (!name || /[\t\r\n"]/.test(name) || name.split(':').some((segment) => segment.length > entity.maxNameLength)) {
        invalid.add(rowKey(entity));
      }
    }
    return invalid;
  }, [entities, rows]);

  const submit = () => {
    onSubmit(
      entities.map((entity) => {
        const row = rows[rowKey(entity)];
        return {
          algaEntityType: entity.algaEntityType,
          algaEntityId: entity.algaEntityId,
          externalName: row?.name.trim() ?? entity.proposedName,
          mode: row?.mode ?? 'create'
        };
      })
    );
  };

  const footer = (
    <div className="flex justify-end space-x-2">
      <Button id="accounting-exports-unmapped-cancel" variant="ghost" onClick={onCancel} disabled={saving}>
        {t('accountingExports.unmapped.actions.cancel', { defaultValue: 'Cancel' })}
      </Button>
      <Button id="accounting-exports-unmapped-mappings" variant="outline" asChild>
        <Link href={mappingsHref}>
          {t('accountingExports.unmapped.actions.goToMappings', { defaultValue: 'Go to QuickBooks mappings' })}
        </Link>
      </Button>
      <Button
        id="accounting-exports-unmapped-save"
        type="button"
        onClick={submit}
        disabled={saving || !canManageMappings || entities.length === 0 || invalidKeys.size > 0}
      >
        {t('accountingExports.unmapped.actions.save', { defaultValue: 'Save mappings and export' })}
      </Button>
    </div>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onCancel}
      title={t('accountingExports.unmapped.title', { defaultValue: 'Unmapped QuickBooks items' })}
      id="accounting-exports-unmapped-dialog"
      className="max-w-2xl"
      footer={footer}
    >
      <DialogContent>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {isDesktop
              ? t('accountingExports.unmapped.descriptionDesktop', { defaultValue: 'These have no QuickBooks mapping yet. Create them as new entries (the IIF file will add them to QuickBooks Desktop) or link them to an existing QuickBooks entry with the exact same name. Your choices are saved as mappings, so future exports will not ask again.' })
              : t('accountingExports.unmapped.descriptionCsv', { defaultValue: 'These have no QuickBooks mapping yet. Export them under the name below (QuickBooks adds new names when you import the CSV) or link them to an existing QuickBooks entry with the exact same name. Your choices are saved as mappings, so future exports will not ask again.' })}
          </p>

          {!canManageMappings ? (
            <Alert variant="info" id="accounting-exports-unmapped-permission">
              <AlertDescription>
                {t('accountingExports.unmapped.permissionNotice', { defaultValue: 'Saving QuickBooks mappings requires the manage-mappings capability. Ask an administrator, or map these items from the QuickBooks settings.' })}
              </AlertDescription>
            </Alert>
          ) : null}

          {error ? (
            <Alert variant="destructive" id="accounting-exports-unmapped-error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-3">
            {entities.map((entity) => {
              const key = rowKey(entity);
              const row = rows[key] ?? { mode: 'create', name: entity.proposedName };
              const idBase = `accounting-exports-unmapped-${entity.algaEntityType}-${entity.algaEntityId}`
                .toLowerCase()
                .replace(/[^a-z0-9-]+/g, '-');
              return (
                <div key={key} className="grid gap-2 rounded-md border p-3 md:grid-cols-[1fr_12rem_1fr]" id={idBase}>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium" title={entity.algaName}>{entity.algaName}</div>
                    <div className="text-xs text-muted-foreground">{kindLabel(entity)}</div>
                  </div>
                  <CustomSelect
                    id={`${idBase}-mode`}
                    options={[
                      { value: 'create', label: t('accountingExports.unmapped.modes.create', { defaultValue: 'Create new' }) },
                      { value: 'existing', label: t('accountingExports.unmapped.modes.existing', { defaultValue: 'Already in QuickBooks' }) }
                    ]}
                    value={row.mode}
                    onValueChange={(value) =>
                      setRows((prev) => ({ ...prev, [key]: { ...row, mode: value === 'existing' ? 'existing' : 'create' } }))
                    }
                    disabled={saving || !canManageMappings}
                  />
                  <Input
                    id={`${idBase}-name`}
                    aria-label={t('accountingExports.unmapped.nameAria', { defaultValue: 'QuickBooks name for {{name}}', name: entity.algaName })}
                    value={row.name}
                    maxLength={entity.maxNameLength}
                    hasError={invalidKeys.has(key)}
                    onChange={(event) => setRows((prev) => ({ ...prev, [key]: { ...row, name: event.target.value } }))}
                    disabled={saving || !canManageMappings}
                  />
                </div>
              );
            })}
          </div>
          {isDesktop ? (
            <p className="text-xs text-muted-foreground">
              {t('accountingExports.unmapped.desktopNote', { defaultValue: 'New products use the item type chosen in the QuickBooks Desktop settings. Choose "Already in QuickBooks" for anything that exists in your company file, so its details are not overwritten.' })}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
