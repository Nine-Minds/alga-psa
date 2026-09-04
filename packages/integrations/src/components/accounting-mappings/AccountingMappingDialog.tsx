import React, { useEffect, useMemo, useState } from 'react';

import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import type { ExternalEntityMapping } from '@alga-psa/integrations/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getErrorMessage } from '@alga-psa/ui/lib/errorHandling';
import type {
  AccountingMappingContext,
  AccountingMappingEntityOption,
  AccountingMappingModule
} from './types';

type DisplayMapping = ExternalEntityMapping & {
  algaName?: string;
  externalName?: string;
};

type AccountingMappingDialogProps = {
  module: AccountingMappingModule;
  context: AccountingMappingContext;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: {
    algaEntityId: string;
    externalEntityId: string;
    metadata?: Record<string, unknown> | null;
    mappingId?: string;
  }) => Promise<void>;
  existingMapping?: DisplayMapping | null;
  algaEntities: AccountingMappingEntityOption[];
  externalEntities: AccountingMappingEntityOption[];
  realmLabel?: string;
};

export function AccountingMappingDialog({
  module,
  context,
  isOpen,
  onClose,
  onSubmit,
  existingMapping,
  algaEntities,
  externalEntities,
  realmLabel
}: AccountingMappingDialogProps) {
  const { t } = useTranslation('msp/integrations');
  const resolvedRealmLabel = realmLabel ?? t('integrations.accounting.dialog.realmIdLabel', { defaultValue: 'Realm ID' });
  const dialogId = module.elements?.dialog ?? `${module.id}-mapping-dialog`;

  const isEditing = Boolean(existingMapping);
  const targetConfig = module.externalTarget;
  const [selectedAlgaId, setSelectedAlgaId] = useState<string>('');
  const [selectedExternalId, setSelectedExternalId] = useState<string>('');
  const [selectedKindId, setSelectedKindId] = useState<string>('');
  const [staleTarget, setStaleTarget] = useState(false);
  const [metadataInput, setMetadataInput] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (existingMapping) {
      setSelectedAlgaId(existingMapping.alga_entity_id ?? '');
      if (targetConfig) {
        // The stored mapping selects a specific kind-scoped catalog option.
        // When that option is gone from the live catalog (legacy code that no
        // longer resolves), start the picker EMPTY: saving again must be an
        // explicit re-selection, never a silent re-persist of a stale target.
        const storedOptionId = targetConfig.optionIdForMapping(existingMapping);
        const stillExists = externalEntities.some((entity) => entity.id === storedOptionId);
        setSelectedKindId(targetConfig.kindForMapping(existingMapping));
        setSelectedExternalId(stillExists ? storedOptionId : '');
        setStaleTarget(!stillExists);
      } else {
        setSelectedExternalId(existingMapping.external_entity_id ?? '');
        setStaleTarget(false);
      }
      if (module.metadata?.enableJsonEditor) {
        setMetadataInput(
          existingMapping.metadata ? JSON.stringify(existingMapping.metadata, null, 2) : ''
        );
      } else {
        setMetadataInput('');
      }
    } else {
      setSelectedAlgaId('');
      setSelectedExternalId('');
      setSelectedKindId(targetConfig?.defaultKindId ?? '');
      setStaleTarget(false);
      setMetadataInput('');
    }
    setError(null);
    setIsSaving(false);
  }, [isOpen, existingMapping, module.metadata, targetConfig, externalEntities]);

  const dialogTitle = useMemo(
    () =>
      isEditing
        ? module.labels.dialog.editTitle
        : module.labels.dialog.addTitle,
    [isEditing, module.labels.dialog]
  );

  const cancelButtonId = `${dialogId}-cancel-button`;
  const saveButtonId = `${dialogId}-save-button`;

  const algaOptions = useMemo(
    () => algaEntities.map((entity) => ({ value: entity.id, label: entity.name })),
    [algaEntities]
  );

  const externalOptions = useMemo(
    () =>
      externalEntities
        .filter((entity) => !targetConfig || !entity.kind || entity.kind === selectedKindId)
        .map((entity) => ({ value: entity.id, label: entity.name })),
    [externalEntities, targetConfig, selectedKindId]
  );

  const kindOptions = useMemo(
    () => (targetConfig ? targetConfig.kinds.map((kind) => ({ value: kind.id, label: kind.label })) : []),
    [targetConfig]
  );

  const hasExternalOptions = externalOptions.length > 0;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    let parsedMetadata: Record<string, unknown> | null = null;
    if (module.metadata?.enableJsonEditor && metadataInput.trim()) {
      try {
        parsedMetadata = JSON.parse(metadataInput);
      } catch (parseError) {
        setError(t('integrations.accounting.dialog.errors.invalidJson', { defaultValue: 'Invalid JSON format for metadata.' }));
        setIsSaving(false);
        return;
      }
    }

    // Validate Alga entity selection
    if (!selectedAlgaId) {
      setError(t('integrations.accounting.dialog.errors.selectAlga', { defaultValue: 'Please select {{field}}.', field: module.labels.dialog.algaField.toLowerCase() }));
      setIsSaving(false);
      return;
    }

    const trimmedExternalId = selectedExternalId.trim();
    if (!trimmedExternalId) {
      setError(
        hasExternalOptions
          ? t('integrations.accounting.dialog.errors.selectExternal', { defaultValue: 'Please select {{field}}.', field: module.labels.dialog.externalField.toLowerCase() })
          : t('integrations.accounting.dialog.errors.enterExternal', { defaultValue: 'Please enter {{field}}.', field: module.labels.dialog.externalField.toLowerCase() })
      );
      setIsSaving(false);
      return;
    }

    try {
      await onSubmit({
        algaEntityId: selectedAlgaId,
        externalEntityId: trimmedExternalId,
        metadata: parsedMetadata,
        mappingId: existingMapping?.id
      });
      onClose();
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setIsSaving(false);
    }
  };

  const renderExternalFieldHelpText = () => {
    // Show module-specific help text if available
    if (module.labels.dialog.helpText) {
      return (
        <p className="text-xs text-muted-foreground">
          {module.labels.dialog.helpText}
        </p>
      );
    }
    // Fallback for manual entry when no catalog data
    if (!hasExternalOptions) {
      return (
        <p className="text-xs text-muted-foreground">
          {t('integrations.accounting.dialog.manualEntryHelp', { defaultValue: 'Enter the identifier exactly as it appears in your accounting system.' })}
        </p>
      );
    }
    return null;
  };

  const formId = `${dialogId}-form`;

  const footer = (
    <div className="flex items-center justify-end gap-3">
      <Button id={cancelButtonId} type="button" variant="outline" onClick={onClose}>
        {module.labels.deleteConfirmation.cancelLabel ?? t('integrations.accounting.dialog.cancel', { defaultValue: 'Cancel' })}
      </Button>
      <Button
        id={saveButtonId}
        type="button"
        disabled={isSaving}
        onClick={() => (document.getElementById(formId) as HTMLFormElement | null)?.requestSubmit()}
      >
        {isSaving
          ? t('integrations.accounting.dialog.saving', { defaultValue: 'Saving…' })
          : t('integrations.accounting.dialog.saveMapping', { defaultValue: 'Save Mapping' })}
      </Button>
    </div>
  );

  return (
    <Dialog id={dialogId} isOpen={isOpen} onClose={onClose} title={dialogTitle} footer={footer}>
      <DialogContent className="sm:max-w-[520px]">
        <form id={formId} onSubmit={handleSubmit} className="space-y-6 py-4">
          <div className="space-y-2">
            <Label htmlFor={`${module.id}-alga-select`} className="text-sm font-medium text-foreground">
              {module.labels.dialog.algaField}
            </Label>
            <CustomSelect
              id={`${module.id}-alga-select`}
              options={algaOptions}
              value={selectedAlgaId}
              onValueChange={(value: string) => setSelectedAlgaId(value || '')}
              placeholder={t('integrations.accounting.dialog.selectPlaceholder', { defaultValue: 'Select {{field}}...', field: module.labels.dialog.algaField })}
              required
              className="w-full"
            />
          </div>

          {targetConfig ? (
            <div className="space-y-2">
              <Label htmlFor={`${module.id}-target-kind-select`} className="text-sm font-medium text-foreground">
                {targetConfig.label}
              </Label>
              <CustomSelect
                id={`${module.id}-target-kind-select`}
                options={kindOptions}
                value={selectedKindId}
                onValueChange={(value: string) => {
                  setSelectedKindId(value || targetConfig.defaultKindId);
                  // A kind names a different provider catalog; a selection made
                  // under the previous kind is meaningless under the new one.
                  setSelectedExternalId('');
                }}
                placeholder={t('integrations.accounting.dialog.selectPlaceholder', { defaultValue: 'Select {{field}}...', field: targetConfig.label })}
                required
                className="w-full"
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor={`${module.id}-external-select`} className="text-sm font-medium text-foreground">
              {module.labels.dialog.externalField}
            </Label>
            {hasExternalOptions || targetConfig ? (
              // With a multi-catalog target config the picker is catalog-backed
              // only — no free-text fallback, so an arbitrary string, display
              // name, or other-organisation code can never be submitted.
              <CustomSelect
                id={`${module.id}-external-select`}
                options={externalOptions}
                value={selectedExternalId}
                onValueChange={(value: string) => setSelectedExternalId(value || '')}
                placeholder={t('integrations.accounting.dialog.selectPlaceholder', { defaultValue: 'Select {{field}}...', field: module.labels.dialog.externalField })}
                required
                className="w-full"
              />
            ) : (
              <Input
                id={`${module.id}-external-manual-input`}
                value={selectedExternalId}
                onChange={(event) => setSelectedExternalId(event.target.value)}
                placeholder={t('integrations.accounting.dialog.enterPlaceholder', { defaultValue: 'Enter {{field}}...', field: module.labels.dialog.externalField })}
                className="w-full"
                required
              />
            )}
            {targetConfig && !hasExternalOptions ? (
              <p className="text-xs text-muted-foreground">
                {t('integrations.accounting.dialog.noKindOptions', {
                  defaultValue: 'No usable records of this type were found in the connected organisation.'
                })}
              </p>
            ) : null}
            {targetConfig && staleTarget ? (
              <p
                data-testid={`${module.id}-stale-target-notice`}
                className="rounded-md border border-[rgb(var(--badge-warning-border))] bg-[rgb(var(--badge-warning-bg))] px-3 py-2 text-xs text-[rgb(var(--badge-warning-text))]"
              >
                {targetConfig.invalidNotice}
              </p>
            ) : null}
            {renderExternalFieldHelpText()}
          </div>

          {context.realmId || context.realmDisplayValue ? (
            <div className="space-y-2">
              <Label htmlFor={`${module.id}-realm-id`} className="text-sm font-medium text-foreground">
                {resolvedRealmLabel}
              </Label>
              <Input
                id={`${module.id}-realm-id`}
                value={context.realmDisplayValue ?? context.realmId ?? ''}
                readOnly
                disabled
                className="w-full bg-muted text-sm"
              />
            </div>
          ) : null}

          {module.metadata?.enableJsonEditor ? (
            <div className="space-y-2">
              <Label htmlFor={`${module.id}-metadata`} className="text-sm font-medium text-foreground">
                {t('integrations.accounting.dialog.metadataLabel', { defaultValue: 'Metadata (JSON)' })}
              </Label>
              <TextArea
                id={`${module.id}-metadata`}
                value={metadataInput}
                onChange={(event) => setMetadataInput(event.target.value)}
                placeholder={t('integrations.accounting.dialog.metadataPlaceholder', { defaultValue: 'Optional metadata as JSON' })}
                className="max-w-none font-mono text-xs leading-5"
              />
            </div>
          ) : null}

          {error ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
